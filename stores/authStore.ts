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
  register: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
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
      // Check for existing session (short timeout so app shows login quickly if Supabase is slow)
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        timeout(3000),
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
        if (event === 'SIGNED_IN' && session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();

          set({
            session,
            user: profile,
            isAuthenticated: true,
          });
          if (Constants.appOwnership !== 'expo') registerPushToken(session.user.id).catch(() => {});
        } else if (event === 'SIGNED_OUT') {
          set({
            session: null,
            user: null,
            isAuthenticated: false,
          });
        }
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Login failed' };
    }
  },

  register: async (email, password, fullName) => {
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
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
    await supabase.auth.signOut();
    set({
      user: null,
      session: null,
      isAuthenticated: false,
    });
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
