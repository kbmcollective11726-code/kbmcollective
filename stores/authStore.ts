import { create } from 'zustand';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { getPasswordResetRedirectUrl } from '../lib/passwordResetRedirect';
import { registerPushToken } from '../lib/pushNotifications';
import { useEventStore } from './eventStore';
import { User } from '../lib/types';

/** Single listener for login / logout / refresh (call once after session restore). */
function bindSupabaseAuthListener(
  set: (partial: Record<string, unknown> | ((state: AuthStore) => Record<string, unknown>)) => void,
  get: () => AuthStore
) {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      useEventStore.getState().clearForLogout();
      set({
        session: null,
        user: null,
        isAuthenticated: false,
      });
      return;
    }
    if (session?.user) {
      if (event === 'TOKEN_REFRESHED') {
        set({ session, isAuthenticated: true });
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      set({
        session,
        user: profile ?? get().user,
        isAuthenticated: true,
      });
      if (Constants.appOwnership !== 'expo' && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        registerPushToken(session.user.id).catch(() => {});
      }
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
  resetPassword: (email: string) => Promise<{ error: string | null }>;
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
      // Check for existing session (timeout so app shows login if Supabase is unreachable)
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        timeout(8000),
      ]);

      if (session?.user) {
        // Fetch the full user profile (maybeSingle avoids throw when row missing or duplicate)
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        set({
          session,
          user: profile ?? null,
          isAuthenticated: true,
          isLoading: false,
        });
        if (Constants.appOwnership !== 'expo') registerPushToken(session.user.id).catch(() => {});
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Auth initialization error:', error);
      // Race timeout or network glitch: session may still exist in AsyncStorage — recover instead of showing logged out
      try {
        const { data: { session: recovered } } = await supabase.auth.getSession();
        if (recovered?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', recovered.user.id)
            .maybeSingle();
          set({
            session: recovered,
            user: profile ?? null,
            isAuthenticated: true,
            isLoading: false,
          });
          if (Constants.appOwnership !== 'expo') registerPushToken(recovered.user.id).catch(() => {});
        }
      } catch {
        /* fall through */
      }
      if (!get().isAuthenticated) {
        set({ isLoading: false });
      }
    }

    bindSupabaseAuthListener(set, get);
  },

  login: async (email, password) => {
    const LOGIN_TIMEOUT_MS = 45000; // 45s for slow / weak connections (e.g. SOS only, poor Wi‑Fi)
    const timeoutPromise = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign in timed out. Check your connection and try again.')), ms)
      );

    const doLogin = async () => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) return { error: error.message };
      if (data?.session?.user) {
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.session.user.id)
          .maybeSingle();
        set({
          session: data.session,
          user: profile ?? null,
          isAuthenticated: true,
        });
      }
      return { error: null };
    };

    try {
      const result = await Promise.race([doLogin(), timeoutPromise(LOGIN_TIMEOUT_MS)]);
      return result;
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (msg.includes('timed out') || msg.includes('Sign in timed out')) {
        // One automatic retry for slow/unstable connections before showing error
        try {
          const retryResult = await Promise.race([doLogin(), timeoutPromise(LOGIN_TIMEOUT_MS)]);
          return retryResult;
        } catch (retryErr: any) {
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

    const doSignUp = () =>
      supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: fullName } },
      });

    try {
      if (__DEV__) console.log('[Register authStore] calling supabase.auth.signUp');
      let result = await withTimeout(doSignUp(), REGISTER_TIMEOUT_MS);
      const { data, error } = result;
      if (__DEV__) console.log('[Register authStore] signUp returned — data:', JSON.stringify(data ? { session: !!data.session, user: !!data.user } : null), 'error:', error ? { message: error.message, name: error.name } : null);

      if (error) {
        if (__DEV__) console.log('[Register authStore] Supabase signUp failed — exact error object:', error);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered')) {
          return { error: 'User already registered. Sign in with your email and password instead.' };
        }
        return { error: error.message };
      }
      const authUser = data?.session?.user;

      if (!data?.session && data?.user) {
        return { error: null, needsEmailConfirmation: true };
      }
      if (!data?.session || !authUser) {
        return { error: null, needsEmailConfirmation: true };
      }

      // Session is already set by signUp; no need for setSession (saves a round-trip and speeds up registration).

      const now = new Date().toISOString();
      const minimalUser: User = {
        id: authUser.id,
        email: authUser.email ?? email.trim().toLowerCase(),
        full_name: (authUser.user_metadata?.full_name as string) ?? fullName.trim() ?? 'User',
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
        session: data.session,
        user: minimalUser,
        isAuthenticated: true,
      });
      supabase.from('users').select('*').eq('id', authUser.id).maybeSingle().then(
        ({ data: profile, error: profileError }) => {
          if (__DEV__) console.log('[Register authStore] users select after signUp — data:', profile, 'error:', profileError);
          if (profile) void get().refreshUser();
        },
        (e) => {
          if (__DEV__) console.log('[Register authStore] users select after signUp — catch error object:', e);
        }
      );

      return { error: null };
    } catch (err: any) {
      if (__DEV__) console.log('[Register authStore] signUp catch — exact error object:', err);
      const msg = String(err?.message ?? err);
      if (msg.includes('timed out')) {
        // One automatic retry for slow connections (e.g. iOS / first request)
        try {
          const retryResult = await withTimeout(doSignUp(), REGISTER_TIMEOUT_MS);
          const { error } = retryResult;
          if (error) {
            const em = (error.message || '').toLowerCase();
            if (em.includes('already registered') || em.includes('already exists')) {
              return { error: 'User already registered. Sign in with your email and password instead.' };
            }
            return { error: error.message };
          }
          if (!retryResult.data?.session && retryResult.data?.user) {
            return { error: null, needsEmailConfirmation: true };
          }
          if (retryResult.data?.session?.user) {
            const authUser = retryResult.data.session.user;
            const minimalUser: User = {
              id: authUser.id,
              email: authUser.email ?? email.trim().toLowerCase(),
              full_name: (authUser.user_metadata?.full_name as string) ?? fullName.trim() ?? 'User',
              avatar_url: null,
              title: null,
              company: null,
              linkedin_url: null,
              bio: null,
              phone: null,
              push_token: null,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            set({
              session: retryResult.data.session,
              user: minimalUser,
              isAuthenticated: true,
            });
            supabase.from('users').select('*').eq('id', authUser.id).maybeSingle().then(
              ({ data: profile }) => { if (profile) void get().refreshUser(); },
              () => {}
            );
            return { error: null };
          }
        } catch (_) {}
        return { error: 'Request timed out. Check your connection and try again.' };
      }
      return { error: err?.message || 'Registration failed' };
    }
  },

  resetPassword: async (email) => {
    try {
      const redirectTo = getPasswordResetRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo,
      });
      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to send reset email' };
    }
  },

  logout: async () => {
    // Clear event store so next user never sees previous user's event
    useEventStore.getState().clearForLogout();
    // Clear state first so UI updates immediately; signOut in background so logout never "hangs"
    set({
      user: null,
      session: null,
      isAuthenticated: false,
    });
    Promise.resolve().then(() => supabase.auth.signOut().catch(() => {}));
  },

  updateProfile: async (updates) => {
    const { user } = get();
    if (!user) return { error: 'Not authenticated' };

    try {
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id)
        .select()
        .maybeSingle();

      if (error) return { error: error.message };
      if (data) set({ user: data });
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

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (data) set({ user: data });
  },
}));
