import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../stores/authStore';
import { isSupabaseConfigured } from '../../lib/supabase';
import { isOtaUpdatesEnabled, syncAppUpdateOnLaunch } from '../../lib/appUpdates';
import { peekPendingBadgeToken } from '../../lib/pendingBadgeUrl';
import { markPlatformAdminAllEventsLanding, PLATFORM_ADMIN_ALL_EVENTS_HREF } from '../../lib/platformAdminNav';
import { openExternalUrl } from '../../lib/openExternalUrl';

const LOGO = require('../../assets/logo-full-transparent.png');

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ requestReset?: string }>();
  const resetHelpShown = useRef(false);
  const { login, resetPassword } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(isOtaUpdatesEnabled());
  const otaChecked = useRef(false);

  useEffect(() => {
    if (!isOtaUpdatesEnabled() || otaChecked.current) return;
    if (peekPendingBadgeToken()) {
      setCheckingUpdate(false);
      return;
    }
    otaChecked.current = true;
    void (async () => {
      try {
        await syncAppUpdateOnLaunch({ maxWaitMs: 25_000 });
      } finally {
        setCheckingUpdate(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (params.requestReset !== '1' || resetHelpShown.current) return;
    resetHelpShown.current = true;
    Alert.alert(
      'Get a new reset email',
      'You do not need your current password. Enter your email above, then tap Forgot password. Open the new email in your mail app (not Outlook) and tap Reset my password once.',
    );
  }, [params.requestReset]);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter email and password.');
      return;
    }
    if (!isSupabaseConfigured) {
      Alert.alert(
        'Not configured',
        'Supabase URL is missing. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env in the project root, then run: npx expo start --clear'
      );
      return;
    }
    setLoading(true);
    try {
      const { error } = await login(email.trim().toLowerCase(), password);
      if (error) {
      const msg = typeof error === 'string' ? error : String((error as { message?: string })?.message ?? 'Login failed');
      const isConnectionError = /502|invalid_response|Connection problem|Restart Expo|timed out/i.test(msg) || msg.includes('_bodyInit') || msg.includes('"status":');
      const hint = isConnectionError
        ? ''
        : msg.toLowerCase().includes('confirm')
          ? ' Check your email for a confirmation link, or in Supabase turn off "Confirm email" under Auth → Providers → Email.'
          : msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials')
            ? ' Check your password (and that the email is correct). Use "Forgot password?" to reset.'
            : '';
      const display = isConnectionError && msg.length > 120 ? 'Connection problem: server returned an invalid response. Try: 1) Restart Expo with "npx expo start --clear" 2) Use Wi‑Fi (same network as PC) 3) In Supabase Dashboard, confirm the project is not paused.' : msg + hint;
        Alert.alert('Login failed', display);
        return;
      }
      const session = useAuthStore.getState().session;
      const mustChangePassword = !!session?.user?.user_metadata?.must_change_password;
      if (mustChangePassword) {
        router.replace('/(auth)/change-password');
      } else if (peekPendingBadgeToken()) {
        router.replace('/(tabs)/home');
      } else {
        const user = useAuthStore.getState().user;
        if (user?.is_platform_admin) {
          markPlatformAdminAllEventsLanding();
          router.replace(PLATFORM_ADMIN_ALL_EVENTS_HREF);
        } else {
          router.replace('/(tabs)/home');
        }
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoWrap}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          {checkingUpdate ? (
            <View style={styles.updateBanner}>
              <ActivityIndicator color="#d4af37" size="small" />
              <Text style={styles.updateBannerText}>Checking for app updates…</Text>
            </View>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#94a3b8"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            Your account is saved. Use the same email and password to sign in anytime.
          </Text>

          <TouchableOpacity
            style={styles.forgotLink}
            onPress={async () => {
              const emailToUse = email.trim() || 'your@email.com';
              const msg = email.trim()
                ? `Send password reset to ${email.trim()}?`
                : 'Enter your email above, then tap Forgot password again, or we’ll use it when you enter it.';
              if (!email.trim()) {
                Alert.alert('Forgot password', 'Enter your email in the field above, then tap "Forgot password?" again to receive a reset link.');
                return;
              }
              const normalizedEmail = email.trim().toLowerCase();
              Alert.alert(
                'Send reset email?',
                `We will send a password reset link to ${normalizedEmail} if an account exists for that address.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send email',
                    onPress: async () => {
                      setResetting(true);
                      const { error, outcome } = await resetPassword(normalizedEmail);
                      setResetting(false);
                      if (error) {
                        Alert.alert(
                          'Could not send reset email',
                          'Please try again in a few minutes. If it keeps failing, contact your event organizer for help.',
                        );
                        return;
                      }
                      if (outcome === 'sent') {
                        Alert.alert(
                          'Reset email sent',
                          `We sent a password reset link to ${normalizedEmail}.\n\nCheck your inbox and Junk/Spam folder. Open the email in your mail app (not Outlook), then tap Reset my password once.`,
                        );
                        return;
                      }
                      if (outcome === 'rate_limited') {
                        Alert.alert(
                          'Check your email',
                          `A reset email was already sent recently to ${normalizedEmail}.\n\nCheck your inbox and Junk/Spam folder before requesting another. Wait 15 minutes if you do not see it.`,
                        );
                        return;
                      }
                      if (outcome === 'delivery_failed') {
                        Alert.alert(
                          'Email not sent',
                          'We could not send the reset email right now. Please try again in a few minutes.',
                        );
                        return;
                      }
                      Alert.alert(
                        'Check your email',
                        `If an account exists for ${normalizedEmail}, we sent a reset link.\n\nCheck your inbox and Junk/Spam folder. Use the exact email you registered with.`,
                      );
                    },
                  },
                ],
              );
            }}
            disabled={loading || resetting}
          >
            <Text style={styles.forgotText}>{resetting ? 'Sending…' : 'Forgot password?'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.link}
            onPress={() => router.push('/(auth)/register')}
            disabled={loading}
          >
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkBold}>Sign up</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.requestEventLink}
            onPress={() => {
              void openExternalUrl('https://kbmcollective.org/request-event.html').then((ok) => {
                if (!ok) {
                  Alert.alert(
                    'Could not open link',
                    'Open https://kbmcollective.org/request-event.html in your browser to request event setup.',
                  );
                }
              });
            }}
            disabled={loading}
          >
            <Text style={styles.linkText}>
              Need an event? <Text style={styles.linkBold}>Request event setup</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 0,
  },
  logo: {
    width: '100%',
    maxWidth: 380,
    height: 220,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 16,
    textAlign: 'center',
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  updateBannerText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#f8fafc',
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
  },
  button: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#d4af37',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  forgotLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  forgotText: {
    fontSize: 14,
    color: '#d4af37',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  link: {
    marginTop: 24,
    alignItems: 'center',
  },
  requestEventLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  linkBold: {
    color: '#d4af37',
    fontWeight: '600',
  },
});
