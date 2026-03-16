import { create } from 'zustand';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { registerPushToken } from '../lib/pushNotifications';
import { User } from '../lib/types';

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
        // Fetch the full user profile
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        set({
          session,
          user: profile,
          isAuthenticated: true,
          isLoading: false,
        });
        if (Constants.appOwnership !== 'expo') registerPushToken(session.user.id).catch(() => {});
      } else {
        set({ isLoading: false });
      }

      // Listen for auth changes (login, logout, token refresh)
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          set({
            session: null,
            user: null,
            isAuthenticated: false,
          });
          return;
        }
        // Keep session in sync: SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED
        if (session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();

          set({
            session,
            user: profile ?? get().user,
            isAuthenticated: true,
          });
          // Register push token only on sign-in or initial load, not on TOKEN_REFRESHED (avoids redundant updates, no duplicate notifications)
          if (Constants.appOwnership !== 'expo' && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
            registerPushToken(session.user.id).catch(() => {});
          }
        }
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ isLoading: false });
    }
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
          .single();
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
      let result = await withTimeout(doSignUp(), REGISTER_TIMEOUT_MS);
      const { data, error } = result;

      if (error) {
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
      supabase.from('users').select('*').eq('id', authUser.id).single().then(
        ({ data: profile }) => { if (profile) void get().refreshUser(); },
        () => {}
      );

      return { error: null };
    } catch (err: any) {
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
            supabase.from('users').select('*').eq('id', authUser.id).single().then(
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
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: 'collectivelive://reset-password',
      });
      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to send reset email' };
    }
  },

  logout: async () => {
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
        .single();

      if (error) return { error: error.message };

      set({ user: data });
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Update failed' };
    }
  },

  refreshUser: async () => {
    const { user } = get();
    if (!user) return;

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (data) set({ user: data });
  },
}));
