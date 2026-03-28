import { useAuthStore } from '../stores/authStore';
import { supabase, updateAuthUserPasswordWithNativeFetch } from './supabase';

export type SignedInPasswordUpdateResult =
  | { ok: true }
  | { ok: false; title: string; message: string };

const SDK_FALLBACK_MS = 45000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

/**
 * Updates password for the current session (native GoTrue fetch first, SDK fallback).
 * Caller should wrap with UI loading state; this does not call Alert.
 */
export async function updateSignedInUserPassword(
  newPassword: string,
  refreshUser: () => Promise<void>,
): Promise<SignedInPasswordUpdateResult> {
  try {
    supabase.auth.stopAutoRefresh();

    const cur = useAuthStore.getState().session;
    const token = cur?.access_token;
    if (!token) {
      return {
        ok: false,
        title: 'Session missing',
        message: 'Sign out, sign in again, then set your new password.',
      };
    }

    const native = await updateAuthUserPasswordWithNativeFetch(token, newPassword);
    if (!native.ok) {
      try {
        const res = await withTimeout(
          supabase.auth.updateUser({
            password: newPassword,
            data: { must_change_password: false },
          }),
          SDK_FALLBACK_MS,
          'Password update',
        );
        if (res.error) {
          return {
            ok: false,
            title: 'Update failed',
            message: `${native.message}\n\n(SDK fallback) ${res.error.message}`,
          };
        }
        const curAfter = useAuthStore.getState().session;
        if (curAfter && res.data?.user) {
          useAuthStore.setState({ session: { ...curAfter, user: res.data.user } });
        }
      } catch {
        return {
          ok: false,
          title: 'Update failed',
          message:
            native.message ||
            'Could not reach Supabase. Check the project URL in .env and that the project is not paused.',
        };
      }
    } else {
      const cur2 = useAuthStore.getState().session;
      if (cur2?.user) {
        useAuthStore.setState({
          session: {
            ...cur2,
            user: {
              ...cur2.user,
              user_metadata: {
                ...(cur2.user.user_metadata && typeof cur2.user.user_metadata === 'object'
                  ? cur2.user.user_metadata
                  : {}),
                must_change_password: false,
              },
            },
          },
        });
      }
    }

    void supabase.auth.refreshSession().then(({ data: ref }) => {
      if (ref?.session) {
        useAuthStore.setState({ session: ref.session });
      }
    });

    await Promise.race([
      refreshUser(),
      new Promise<void>((resolve) => setTimeout(resolve, 6000)),
    ]);

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('timed out')) {
      return {
        ok: false,
        title: 'Can’t reach server',
        message:
          'Supabase didn’t answer in time.\n\n• Dashboard: project not paused\n• .env: EXPO_PUBLIC_SUPABASE_URL matches this app\n• Expo Go: npx expo start --tunnel',
      };
    }
    return {
      ok: false,
      title: 'Error',
      message: msg || 'Something went wrong. Try again.',
    };
  } finally {
    supabase.auth.startAutoRefresh();
  }
}
