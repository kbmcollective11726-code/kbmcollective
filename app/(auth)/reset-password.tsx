import { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { consumePendingPasswordRecoveryUrl } from '../../lib/pendingRecoveryUrl';
import { colors } from '../../constants/colors';

/** Parse Supabase recovery redirect: tokens in hash (#) or query (?). */
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

export default function ResetPasswordDeepLinkScreen() {
  const router = useRouter();
  const [message, setMessage] = useState('Opening reset link…');
  const [failed, setFailed] = useState(false);

  const handleUrl = useCallback(
    async (url: string | null) => {
      if (!url) return;

      const params = parseAuthParamsFromUrl(url);
      const access_token = params.access_token;
      const refresh_token = params.refresh_token;

      if (access_token && refresh_token) {
        setMessage('Signing you in…');
        setFailed(false);
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          setFailed(true);
          setMessage(`Could not complete reset: ${error.message}`);
          return;
        }
        router.replace('/(auth)/change-password');
        return;
      }

      if (params.error) {
        setFailed(true);
        setMessage(params.error_description || params.error || 'This reset link is invalid or expired.');
        return;
      }

      setFailed(true);
      setMessage(
        'No login tokens in this link. If you opened the email in a browser and saw localhost, add your app redirect URL in Supabase (see app docs: PASSWORD-RESET-SUPABASE.md).',
      );
    },
    [router],
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      const pending = consumePendingPasswordRecoveryUrl();
      const initial = pending ?? (await Linking.getInitialURL());
      if (alive && initial) await handleUrl(initial);
    })();

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [handleUrl]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      <Text style={styles.text}>{message}</Text>
      {failed ? (
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Back to sign in</Text>
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
