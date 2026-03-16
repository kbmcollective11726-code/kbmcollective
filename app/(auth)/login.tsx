import { useState } from 'react';
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
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../stores/authStore';
import { isSupabaseConfigured } from '../../lib/supabase';

const LOGO = require('../../assets/logo-full-transparent.png');

export default function LoginScreen() {
  const router = useRouter();
  const { login, resetPassword } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

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
      } else {
        const user = useAuthStore.getState().user;
        if (user?.is_platform_admin) {
          router.replace('/profile/admin-all-events');
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
              setResetting(true);
              const { error } = await resetPassword(email.trim());
              setResetting(false);
              if (error) Alert.alert('Reset failed', error);
              else Alert.alert('Check your email', 'We sent a password reset link to ' + email.trim() + '. Open it to set a new password.');
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
            onPress={() => Linking.openURL('https://kbmcollective.org/request-event.html')}
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
