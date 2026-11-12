import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, supabaseAuthNative, supabaseAnonKey, supabaseUrl } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import type { Session } from '@supabase/supabase-js';
import {
  clearPendingPasswordRecoveryUrl,
  peekPendingPasswordRecoveryUrl,
} from '../../lib/pendingRecoveryUrl';
import { isPasswordRecoveryLaunchUrl } from '../../lib/passwordRecoveryLaunchUrl';
import {
  isPasswordRecoveryHandoffComplete,
  markPasswordRecoveryHandoffComplete,
} from '../../lib/passwordRecoveryHandoff';
import {
  friendlyPasswordRecoveryError,
  PASSWORD_RECOVERY_MESSAGES,
} from '../../lib/passwordRecoveryUserMessage';
import { colors } from '../../constants/colors';

let lastSuccessfulRecoveryUrl: string | null = null;

async function resolveRecoveryLaunchUrl(): Promise<string | null> {
  const attempts = 22;
  const gapMs = 100;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, gapMs));
    const fromExpo = Linking.getLinkingURL();
    if (isPasswordRecoveryLaunchUrl(fromExpo ?? undefined)) return fromExpo as string;
    const fromPending = peekPendingPasswordRecoveryUrl();
    if (isPasswordRecoveryLaunchUrl(fromPending ?? undefined)) return fromPending as string;
    const initial = await Linking.getInitialURL();
    if (isPasswordRecoveryLaunchUrl(initial ?? undefined)) return initial as string;
  }
  return null;
}

const AUTH_SET_SESSION_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} (${Math.round(ms / 1000)}s)`)), ms),
    ),
  ]);
}

function parseAuthParamsFromUrl(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const hashStart = url.indexOf('#');
    if (hashStart !== -1) {
      const hash = url.slice(hashStart + 1);
      new URLSearchParams(hash).forEach((v, k) => {
        out[k] = v;
      });
    }
    const qStart = url.indexOf('?');
    if (qStart !== -1) {
      const qEnd = url.indexOf('#', qStart);
      const query = qEnd === -1 ? url.slice(qStart + 1) : url.slice(qStart + 1, qEnd);
      new URLSearchParams(query).forEach((v, k) => {
        if (!(k in out)) out[k] = v;
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function verifyRecoveryInApp(tokenHash: string): Promise<Session | null> {
  try {
    const { data, error } = await withTimeout(
      supabaseAuthNative.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      }),
      AUTH_SET_SESSION_MS,
      'Verification timed out',
    );
    if (!error && data.session) return data.session;
  } catch {
    /* try native fetch */
  }

  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !supabaseAnonKey) return null;
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/verify`;
  try {
    const res = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ token_hash: tokenHash, type: 'recovery' }),
    });
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      throw new Error(body.error_description || body.error || 'Verification failed');
    }
    const { data, error } = await supabaseAuthNative.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error || !data.session) {
      throw new Error(error?.message || 'Could not start reset session');
    }
    return data.session;
  } catch {
    return null;
  }
}

async function adoptRecoverySession(session: Session | null | undefined): Promise<void> {
  if (session?.user) {
    useAuthStore.setState({ session, isAuthenticated: true });
    return;
  }
  const {
    data: { session: stored },
  } = await supabase.auth.getSession();
  if (stored?.user) {
    useAuthStore.setState({ session: stored, isAuthenticated: true });
  }
}

async function finishRecoveryHandoff(router: ReturnType<typeof useRouter>, url: string): Promise<void> {
  lastSuccessfulRecoveryUrl = url;
  markPasswordRecoveryHandoffComplete();
  clearPendingPasswordRecoveryUrl();
  await adoptRecoverySession(useAuthStore.getState().session);
  router.replace('/(auth)/change-password');
}

export default function ResetPasswordDeepLinkScreen() {
  const router = useRouter();
  const expoLinkingUrl = Linking.useLinkingURL();
  const handleInFlight = useRef(false);
  const unmounted = useRef(false);
  const [message, setMessage] = useState<string>(PASSWORD_RECOVERY_MESSAGES.opening);
  const [failed, setFailed] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  const fail = useCallback((userMessage: string) => {
    setFailed(true);
    setMessage(userMessage);
    setHasAttempted(true);
  }, []);

  const handleUrl = useCallback(
    async (url: string | null) => {
      if (!url) return;
      if (handleInFlight.current) return;
      if (lastSuccessfulRecoveryUrl === url || isPasswordRecoveryHandoffComplete()) {
        await finishRecoveryHandoff(router, url);
        return;
      }

      handleInFlight.current = true;
      try {
        const params = parseAuthParamsFromUrl(url);
        const token_hash = params.token_hash;
        const recoveryType = params.type;
        const access_token = params.access_token;
        const refresh_token = params.refresh_token;
        const code = params.code;

        if (token_hash && recoveryType === 'recovery') {
          setMessage(PASSWORD_RECOVERY_MESSAGES.verifying);
          setFailed(false);
          try {
            const session = await verifyRecoveryInApp(token_hash);
            if (!session) {
              fail(PASSWORD_RECOVERY_MESSAGES.linkExpired);
              return;
            }
            await adoptRecoverySession(session);
            if (unmounted.current) return;
            await finishRecoveryHandoff(router, url);
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            fail(friendlyPasswordRecoveryError(msg));
            return;
          } finally {
            setHasAttempted(true);
          }
        }

        if (access_token && refresh_token) {
          setMessage(PASSWORD_RECOVERY_MESSAGES.signingIn);
          setFailed(false);
          try {
            const { data, error } = await withTimeout(
              supabaseAuthNative.auth.setSession({
                access_token,
                refresh_token,
              }),
              AUTH_SET_SESSION_MS,
              'Sign-in timed out',
            );
            if (error) {
              fail(friendlyPasswordRecoveryError(error.message));
              return;
            }
            await adoptRecoverySession(data.session);
            if (unmounted.current) return;
            await finishRecoveryHandoff(router, url);
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            try {
              const {
                data: { session },
              } = await supabaseAuthNative.auth.getSession();
              if (session) {
                if (unmounted.current) return;
                await finishRecoveryHandoff(router, url);
                return;
              }
            } catch {
              /* fall through */
            }
            fail(friendlyPasswordRecoveryError(msg));
            return;
          } finally {
            setHasAttempted(true);
          }
        }

        if (code) {
          fail(PASSWORD_RECOVERY_MESSAGES.linkTooOld);
          return;
        }

        if (params.error) {
          fail(friendlyPasswordRecoveryError(params.error_description || params.error));
          return;
        }

        fail(PASSWORD_RECOVERY_MESSAGES.linkMissing);
      } finally {
        handleInFlight.current = false;
      }
    },
    [fail, router],
  );

  useEffect(() => {
    if (!expoLinkingUrl || !isPasswordRecoveryLaunchUrl(expoLinkingUrl)) return;
    if (isPasswordRecoveryHandoffComplete()) return;
    void handleUrl(expoLinkingUrl);
  }, [expoLinkingUrl, handleUrl]);

  useEffect(() => {
    unmounted.current = false;
    let alive = true;

    (async () => {
      if (isPasswordRecoveryHandoffComplete()) {
        router.replace('/(auth)/change-password');
        return;
      }

      const launch = await resolveRecoveryLaunchUrl();
      if (!alive) return;
      if (launch) {
        await handleUrl(launch);
        return;
      }
      fail(PASSWORD_RECOVERY_MESSAGES.linkNotFound);
    })();

    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isPasswordRecoveryHandoffComplete()) return;
      void handleUrl(url);
    });

    return () => {
      alive = false;
      unmounted.current = true;
      sub.remove();
    };
  }, [fail, handleUrl, router]);

  useEffect(() => {
    if (failed || hasAttempted) return;
    if (
      message === PASSWORD_RECOVERY_MESSAGES.signingIn ||
      message === PASSWORD_RECOVERY_MESSAGES.verifying
    ) {
      return;
    }
    const t = setTimeout(() => {
      fail(PASSWORD_RECOVERY_MESSAGES.takingTooLong);
    }, 12000);
    return () => clearTimeout(t);
  }, [fail, failed, hasAttempted, message]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {!failed ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      ) : null}
      <Text style={styles.text}>{message}</Text>
      {failed ? (
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(auth)/login?requestReset=1')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Get a new reset email</Text>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  spinner: {
    marginBottom: 20,
  },
  text: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
