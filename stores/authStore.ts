import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session, type User as AuthUser } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { supabase, supabaseUrl } from '../lib/supabase';
import { authStorage } from '../lib/authStorage';
import { clearOfflineCaches } from '../lib/eventOfflineCache';
import { requestAppPasswordReset } from '../lib/appPasswordReset';
import { registerPushToken } from '../lib/pushNotifications';
import { logAuthAttempt } from '../lib/logAuthAttempt';
import { getLoginRateLimitError, recordLoginRateLimitAttempt } from '../lib/loginRateLimit';
import {
  ACCOUNT_DEACTIVATED_MESSAGE,
  isAccountActive,
  rejectIfAccountDeactivated,
} from '../lib/accountActive';
import { setSentryUser } from '../lib/sentry';
import { useEventStore } from './eventStore';
import { useRolePreviewStore } from './rolePreviewStore';
import { useConnectivityStore } from './connectivityStore';
import { User } from '../lib/types';

/** iOS fetch occasionally fails to read a response body ("Unable to resolve data for blob"); a retry usually works. */
function isBlobReadGlitch(message: string): boolean {
  return /unable to resolve data for blob/i.test(message);
}

// ---- Outage support: keep signed-in users in the app with on-device data ----

const OFFLINE_RECOVERY_INTERVAL_MS = 30_000;
const STARTUP_CHECK_TIMEOUT_MS = 5_000;
const profileCacheKey = (userId: string) => `collectivelive_profile_cache_${userId}`;
/** Placeholder profiles built from the auth user; never written to the profile cache. */
const fallbackProfiles = new WeakSet<User>();

function makeFallbackProfile(authUser: AuthUser): User {
  const email = (authUser.email ?? '').trim().toLowerCase();
  const now = new Date().toISOString();
  const profile: User = {
    id: authUser.id,
    email: email || 'unknown@local',
    full_name: email.split('@')[0] || 'User',
    avatar_url: null,
    title: null,
    company: null,
    linkedin_url: null,
    bio: null,
    phone: null,
    push_token: null,
    session_reminder_skip_same_room: true,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  fallbackProfiles.add(profile);
  return profile;
}

async function saveCachedProfile(user: User): Promise<void> {
  try {
    // Device token and phone stay off unencrypted storage.
    const { push_token: _pushToken, phone: _phone, ...rest } = user;
    await AsyncStorage.setItem(profileCacheKey(user.id), JSON.stringify(rest));
  } catch {
    // Best-effort cache
  }
}

async function loadCachedProfile(userId: string): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Omit<User, 'push_token' | 'phone'>;
    return parsed?.id === userId ? { ...parsed, phone: null, push_token: null } : null;
  } catch {
    return null;
  }
}

/** supabase-js default storage key: sb-<project-ref>-auth-token */
function authSessionStorageKey(): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * Session still saved on the device. supabase-js keeps it when a token refresh fails on the
 * network (outage) but returns no session, which would otherwise drop the user at sign-in.
 */
async function readStoredSession(): Promise<Session | null> {
  const key = authSessionStorageKey();
  if (!key) return null;
  try {
    const raw = await authStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed?.refresh_token || !parsed.user?.id) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

let offlineRecoveryTimer: ReturnType<typeof setInterval> | null = null;
let offlineRecoveryInFlight = false;

function stopOfflineRecovery(): void {
  if (offlineRecoveryTimer) clearInterval(offlineRecoveryTimer);
  offlineRecoveryTimer = null;
  offlineRecoveryInFlight = false;
}

/** Retry the token refresh until the server is back, then load the live profile. */
function startOfflineRecovery(): void {
  if (offlineRecoveryTimer) return;
  offlineRecoveryTimer = setInterval(() => {
    if (offlineRecoveryInFlight) return;
    offlineRecoveryInFlight = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error) {
          // Non-network failure (e.g. revoked refresh token): supabase-js signs out; SIGNED_OUT updates the UI.
          if (!isAuthRetryableFetchError(error)) stopOfflineRecovery();
          return;
        }
        if (!data.session) return;
        stopOfflineRecovery();
        useAuthStore.setState({ session: data.session, isAuthenticated: true });
        useConnectivityStore.getState().reportSuccess();
        await useAuthStore.getState().refreshUser();
      } catch {
        // Keep retrying on the next tick
      } finally {
        offlineRecoveryInFlight = false;
      }
    })();
  }, OFFLINE_RECOVERY_INTERVAL_MS);
}

/** Server unreachable at launch: open the app with the saved session and on-device profile. */
async function enterOfflineSession(stored: Session): Promise<void> {
  const profile = (await loadCachedProfile(stored.user.id)) ?? makeFallbackProfile(stored.user);
  useAuthStore.setState({ session: stored, user: profile, isAuthenticated: true, isLoading: false });
  setSentryUser({ id: stored.user.id, email: stored.user.email });
  useConnectivityStore.getState().reportFailure();
  startOfflineRecovery();
}

/**
 * Load public.users profile, or create it if missing (bulk/legacy accounts may have auth without a row).
 * Falls back to a minimal in-memory profile if insert is not allowed so navigation still works.
 */
async function fetchOrCreatePublicUser(authUser: AuthUser): Promise<User> {
  const { data: existingRpc } = await supabase.rpc('get_my_user_profile');
  if (existingRpc) return existingRpc as User;

  const { data: existing } = await supabase
    .from('users')
    .select(
      'id, email, full_name, avatar_url, title, company, linkedin_url, bio, is_active, created_at, updated_at, is_platform_admin, last_login_at, session_reminder_skip_same_room, session_reminder_saved_only'
    )
    .eq('id', authUser.id)
    .maybeSingle();
  if (existing) return { ...(existing as Omit<User, 'push_token' | 'phone'>), phone: null, push_token: null };

  const email = (authUser.email ?? '').trim().toLowerCase();
  const meta = authUser.user_metadata as Record<string, unknown> | undefined;
  const metaName = meta && typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  const full_name = metaName || (email.includes('@') ? email.split('@')[0] : 'User');

  const { error } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      email: email || `noreply+${authUser.id}@users.placeholder`,
      full_name,
    });

  const { data: insertedRpc } = await supabase.rpc('get_my_user_profile');
  if (insertedRpc) return insertedRpc as User;

  const { data: afterRace } = await supabase
    .from('users')
    .select(
      'id, email, full_name, avatar_url, title, company, linkedin_url, bio, is_active, created_at, updated_at, is_platform_admin, last_login_at, session_reminder_skip_same_room, session_reminder_saved_only'
    )
    .eq('id', authUser.id)
    .maybeSingle();
  if (afterRace) return { ...(afterRace as Omit<User, 'push_token' | 'phone'>), phone: null, push_token: null };

  if (__DEV__ && error) console.warn('[auth] users row missing and insert failed; using session fallback:', error.message);
  const fallback = makeFallbackProfile(authUser);
  fallback.full_name = full_name;
  return fallback;
}

let authListenerBound = false;

/** Single listener for login / logout / refresh (call once after session restore). */
function bindSupabaseAuthListener(
  set: (partial: Record<string, unknown> | ((state: AuthStore) => Record<string, unknown>)) => void,
  get: () => AuthStore
) {
  if (authListenerBound) return;
  authListenerBound = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      stopOfflineRecovery();
      useEventStore.getState().clearForLogout();
      void useRolePreviewStore.getState().resetPreview();
      setSentryUser(null);
      set({
        session: null,
        user: null,
        isAuthenticated: false,
      });
      return;
    }
    if (session?.user) {
      // Auth callbacks run while GoTrue is notifying subscribers. Never await
      // another Supabase operation here: doing so can hold the auth lock and
      // block token refreshes, page queries, and uploads.
      set({ session, isAuthenticated: true });
      if (event === 'TOKEN_REFRESHED') {
        return;
      }

      setSentryUser({ id: session.user.id, email: session.user.email });
      setTimeout(() => {
        void (async () => {
          const activeSession = get().session;
          if (activeSession?.user?.id !== session.user.id) return;

          const deactivated = await rejectIfAccountDeactivated(session.user.id);
          if (deactivated) {
            useEventStore.getState().clearForLogout();
            void useRolePreviewStore.getState().resetPreview();
            setSentryUser(null);
            set({ session: null, user: null, isAuthenticated: false });
            return;
          }

          const profile = await fetchOrCreatePublicUser(session.user);
          if (get().session?.user?.id !== session.user.id) return;
          if (!isAccountActive(profile.is_active)) {
            await supabase.auth.signOut();
            return;
          }

          set({ session, user: profile, isAuthenticated: true });
          if (Constants.appOwnership !== 'expo' && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
            registerPushToken(session.user.id).catch(() => {});
          }
        })().catch((error: unknown) => {
          if (__DEV__) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[auth] Deferred profile refresh failed:', message);
          }
        });
      }, 0);
    }
  });
}

interface AuthStore {
  user: User | null;
  session: any | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  register: (email: string, password: string, fullName: string) => Promise<{ error: string | null; needsEmailConfirmation?: boolean }>;
  resetPassword: (email: string) => Promise<import('../lib/appPasswordReset').PasswordResetResult>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<{ error: string | null }>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    const timeout = (ms: number) =>
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), ms));

    try {
      let session: Session | null = null;
      try {
        ({ data: { session } } = await Promise.race([supabase.auth.getSession(), timeout(6000)]));
      } catch (error) {
        if (__DEV__) console.warn('[auth] getSession did not finish; checking saved session', error);
      }

      if (!session?.user) {
        // An expired token can't refresh during an outage: supabase-js returns no session but keeps it saved.
        const stored = await readStoredSession();
        if (stored) {
          await enterOfflineSession(stored);
          return;
        }
        set({ isLoading: false });
        return;
      }

      const deactivated = await withTimeout(
        rejectIfAccountDeactivated(session.user.id),
        STARTUP_CHECK_TIMEOUT_MS,
        null,
      );
      if (deactivated) {
        setSentryUser(null);
        set({
          session: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
        return;
      }

      let profile = await withTimeout<User | null>(fetchOrCreatePublicUser(session.user), 6000, null);
      if (!profile || fallbackProfiles.has(profile)) {
        profile = (await loadCachedProfile(session.user.id)) ?? profile ?? makeFallbackProfile(session.user);
      }

      if (!isAccountActive(profile.is_active)) {
        await supabase.auth.signOut();
        setSentryUser(null);
        set({
          session: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      } else {
        set({
          session,
          user: profile,
          isAuthenticated: true,
          isLoading: false,
        });
        setSentryUser({ id: session.user.id, email: session.user.email });
        if (Constants.appOwnership !== 'expo') registerPushToken(session.user.id).catch(() => {});
      }
    } catch (error) {
      console.error('Auth initialization error:', error);
      if (!get().isAuthenticated) {
        const stored = await readStoredSession();
        if (stored) await enterOfflineSession(stored);
      }
    } finally {
      if (get().isLoading) {
        set({ isLoading: false });
      }
      bindSupabaseAuthListener(set, get);
    }
  },

  login: async (email, password) => {
    const LOGIN_TIMEOUT_MS = 45000; // 45s for slow / weak connections (e.g. SOS only, poor Wi‑Fi)
    const timeoutPromise = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign in timed out. Check your connection and try again.')), ms)
      );

    const normalizedEmail = email.trim().toLowerCase();
    const anonKey =
      (Constants.expoConfig as { extra?: { SUPABASE_ANON_KEY?: string } } | null)?.extra
        ?.SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      '';
    let loginGeneration = 0;

    const finishWithSession = async (session: NonNullable<
      Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']
    >, generation: number) => {
      if (generation !== loginGeneration) return { error: null as string | null, superseded: true as const };
      const deactivated = await rejectIfAccountDeactivated(session.user.id);
      if (generation !== loginGeneration) return { error: null, superseded: true as const };
      if (deactivated) {
        recordLoginRateLimitAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
        });
        logAuthAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
          errorMessage: 'account_deactivated',
          userId: session.user.id,
          anonKey: anonKey.trim(),
        });
        return { error: ACCOUNT_DEACTIVATED_MESSAGE };
      }
      const profile = await fetchOrCreatePublicUser(session.user);
      if (generation !== loginGeneration) return { error: null, superseded: true as const };
      if (!isAccountActive(profile.is_active)) {
        await supabase.auth.signOut();
        recordLoginRateLimitAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
        });
        logAuthAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
          errorMessage: 'account_deactivated',
          userId: session.user.id,
          anonKey: anonKey.trim(),
        });
        return { error: ACCOUNT_DEACTIVATED_MESSAGE };
      }
      recordLoginRateLimitAttempt({
        email: normalizedEmail,
        success: true,
        source: 'mobile',
        accessToken: session.access_token,
      });
      logAuthAttempt({
        email: normalizedEmail,
        success: true,
        source: 'mobile',
        userId: session.user.id,
        anonKey: anonKey.trim(),
        accessToken: session.access_token,
      });
      if (generation !== loginGeneration) return { error: null, superseded: true as const };
      set({
        session,
        user: profile,
        isAuthenticated: true,
      });
      return { error: null as string | null };
    };

    /** If GoTrue finished after a UI timeout, adopt the session instead of leaving a ghost login. */
    const reconcileLateSession = async (generation: number) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return null;
        const result = await finishWithSession(session, generation);
        if (result && 'superseded' in result && result.superseded) return null;
        return result;
      } catch {
        return null;
      }
    };

    const doLogin = async (generation: number) => {
      const rateLimitError = await getLoginRateLimitError(normalizedEmail);
      if (generation !== loginGeneration) return { error: null as string | null, superseded: true as const };
      if (rateLimitError) {
        return { error: rateLimitError };
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (generation !== loginGeneration) return { error: null, superseded: true as const };
      if (error && isBlobReadGlitch(error.message)) {
        // iOS network-layer glitch, not a wrong password: don't count it against the rate limit.
        throw new Error(error.message);
      }
      if (error) {
        recordLoginRateLimitAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
        });
        logAuthAttempt({
          email: normalizedEmail,
          success: false,
          source: 'mobile',
          errorMessage: error.message,
          anonKey: anonKey.trim(),
        });
        return { error: error.message };
      }
      if (data?.session?.user) {
        return finishWithSession(data.session, generation);
      }
      return { error: null as string | null };
    };

    const runAttempt = async () => {
      loginGeneration += 1;
      const generation = loginGeneration;
      try {
        const result = await Promise.race([doLogin(generation), timeoutPromise(LOGIN_TIMEOUT_MS)]);
        if (result && 'superseded' in result && result.superseded) return { error: null };
        return { error: result.error };
      } catch (err: unknown) {
        const msg = String((err as { message?: string })?.message ?? '');
        if (msg.includes('timed out') || msg.includes('Sign in timed out')) {
          const late = await reconcileLateSession(generation);
          if (late) return { error: late.error };
          throw err;
        }
        throw err;
      }
    };

    try {
      return await runAttempt();
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (isBlobReadGlitch(msg)) {
        try {
          return await runAttempt();
        } catch (retryErr: any) {
          const late = await reconcileLateSession(loginGeneration);
          if (late) return { error: late.error };
          if (isBlobReadGlitch(String(retryErr?.message ?? ''))) {
            return { error: 'Sign in hit a connection hiccup. Please try again in a moment.' };
          }
          return { error: String(retryErr?.message ?? '') || 'Login failed' };
        }
      }
      if (msg.includes('timed out') || msg.includes('Sign in timed out')) {
        // One automatic retry for slow/unstable connections before showing error
        try {
          return await runAttempt();
        } catch (retryErr: any) {
          const retryMsg = String(retryErr?.message ?? '');
          if (retryMsg.includes('timed out') || retryMsg.includes('Sign in timed out')) {
            const late = await reconcileLateSession(loginGeneration);
            if (late) return { error: late.error };
          }
          return {
            error:
              'Sign in timed out. Check your connection and try again. If you see "SOS only" or weak signal, try Wi‑Fi or wait for a better connection.',
          };
        }
      }
      if (msg.includes('JSON') && msg.includes('Parse')) {
        return { error: 'Server returned an invalid response. Check your connection and try again, or use Wi‑Fi instead of mobile data.' };
      }
      if (msg.includes('502') || msg.includes('invalid_response') || msg.includes('_bodyInit') || msg.includes('"status":')) {
        return {
          error: 'Connection problem: the server returned an invalid response. Try: 1) Restart Expo with "npx expo start --clear" 2) Use Wi‑Fi (same network as your PC) 3) In Supabase Dashboard, check your project is not paused.',
        };
      }
      return { error: msg || 'Login failed' };
    }
  },

  register: async (email, password, fullName) => {
    const REGISTER_TIMEOUT_MS = 50000; // 50s for slow connections / Supabase triggers
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
      ]);

    const normalizedEmail = email.trim().toLowerCase();
    const displayName = fullName.trim() || 'User';

    const applyRegisteredSession = (session: NonNullable<
      Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']
    >) => {
      const authUser = session.user;
      const now = new Date().toISOString();
      const minimalUser: User = {
        id: authUser.id,
        email: authUser.email ?? normalizedEmail,
        full_name: (authUser.user_metadata?.full_name as string) ?? displayName,
        avatar_url: null,
        title: null,
        company: null,
        linkedin_url: null,
        bio: null,
        phone: null,
        push_token: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      set({
        session,
        user: minimalUser,
        isAuthenticated: true,
      });
      supabase.rpc('get_my_user_profile').then(
        ({ data: profile, error: profileError }) => {
          if (__DEV__) console.log('[Register authStore] users select after signUp — data:', profile, 'error:', profileError);
          if (profile) void get().refreshUser();
        },
        (e) => {
          if (__DEV__) console.log('[Register authStore] users select after signUp — catch error object:', e);
        }
      );
    };

    /** If signUp finished after UI timeout, adopt the session instead of leaving a half-created account. */
    const reconcileLateRegisterSession = async (): Promise<{
      error: string | null;
      needsEmailConfirmation?: boolean;
    } | null> => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return null;
        applyRegisteredSession(session);
        return { error: null };
      } catch {
        return null;
      }
    };

    const doSignUp = () =>
      supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { full_name: fullName } },
      });

    const handleSignUpResult = async (
      result: Awaited<ReturnType<typeof doSignUp>>
    ): Promise<{ error: string | null; needsEmailConfirmation?: boolean }> => {
      const { data, error } = result;
      if (__DEV__) {
        console.log(
          '[Register authStore] signUp returned — data:',
          JSON.stringify(data ? { session: !!data.session, user: !!data.user } : null),
          'error:',
          error ? { message: error.message, name: error.name } : null
        );
      }

      if (error) {
        if (__DEV__) console.log('[Register authStore] Supabase signUp failed — exact error object:', error);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered')) {
          const late = await reconcileLateRegisterSession();
          if (late) return late;
          return { error: 'User already registered. Sign in with your email and password instead.' };
        }
        return { error: error.message };
      }

      if (!data?.session && data?.user) {
        return { error: null, needsEmailConfirmation: true };
      }
      if (!data?.session || !data.session.user) {
        return { error: null, needsEmailConfirmation: true };
      }

      applyRegisteredSession(data.session);
      return { error: null };
    };

    try {
      if (__DEV__) console.log('[Register authStore] calling supabase.auth.signUp');
      return await handleSignUpResult(await withTimeout(doSignUp(), REGISTER_TIMEOUT_MS));
    } catch (err: any) {
      if (__DEV__) console.log('[Register authStore] signUp catch — exact error object:', err);
      const msg = String(err?.message ?? err);
      if (msg.includes('timed out')) {
        const late = await reconcileLateRegisterSession();
        if (late) return late;
        // One automatic retry for slow connections (e.g. iOS / first request)
        try {
          return await handleSignUpResult(await withTimeout(doSignUp(), REGISTER_TIMEOUT_MS));
        } catch (retryErr: any) {
          const lateAgain = await reconcileLateRegisterSession();
          if (lateAgain) return lateAgain;
          return { error: 'Request timed out. Check your connection and try again.' };
        }
      }
      return { error: err?.message || 'Registration failed' };
    }
  },

  resetPassword: async (email) => {
    return requestAppPasswordReset(email);
  },

  logout: async () => {
    const userId = get().user?.id ?? get().session?.user?.id;
    stopOfflineRecovery();
    // Clear event store so next user never sees previous user's event
    useEventStore.getState().clearForLogout();
    void useRolePreviewStore.getState().resetPreview();
    useConnectivityStore.getState().reportSuccess();
    // Clear state first so UI updates immediately; signOut in background so logout never "hangs"
    set({
      user: null,
      session: null,
      isAuthenticated: false,
    });
    setSentryUser(null);
    if (userId) AsyncStorage.removeItem(profileCacheKey(userId)).catch(() => {});
    // Shared phones: drop every saved screen copy from the last user.
    void clearOfflineCaches();
    // A server sign-out can fail during an outage and leave the session saved, which would
    // reopen the app signed in; the local sign-out always clears it from the device.
    Promise.resolve().then(() =>
      withTimeout(supabase.auth.signOut(), STARTUP_CHECK_TIMEOUT_MS, null).finally(() =>
        supabase.auth.signOut({ scope: 'local' }).catch(() => {}),
      ),
    );
  },

  updateProfile: async (updates) => {
    const { user } = get();
    if (!user) return { error: 'Not authenticated' };

    try {
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (error) return { error: error.message };
      const { data: profile } = await supabase.rpc('get_my_user_profile');
      if (profile) set({ user: profile as User });
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Update failed' };
    }
  },

  refreshUser: async () => {
    const { session, user } = get();
    // Allow loading profile when session exists but `user` row wasn't loaded yet (e.g. after password change).
    const id = user?.id ?? session?.user?.id;
    if (!id) return;

    const { data } = await supabase.rpc('get_my_user_profile');

    if (data) set({ user: data as User });
  },
}));

// Keep an on-device copy of the signed-in user's profile for outages.
useAuthStore.subscribe((state, prev) => {
  const user = state.user;
  if (!user || user === prev.user || fallbackProfiles.has(user)) return;
  void saveCachedProfile(user);
});
