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
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { colors } from '../../constants/colors';

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
    setLoading(true);
    const { error } = await login(email.trim(), password);
    setLoading(false);
    if (error) {
      const hint =
        error.toLowerCase().includes('confirm')
          ? ' Check your email for a confirmation link, or in Supabase turn off "Confirm email" under Auth → Providers → Email.'
          : error.toLowerCase().includes('invalid') || error.toLowerCase().includes('credentials')
            ? ' Check your password (and that the email is correct). Use "Forgot password?" to reset.'
            : '';
      Alert.alert('Login failed', error + hint);
      return;
    }
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <View style={styles.content}>
          <Text style={styles.title}>CollectiveLive</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
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
            placeholderTextColor={colors.textMuted}
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
              <ActivityIndicator color={colors.textOnPrimary} />
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  button: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
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
    color: colors.primary,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  link: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  linkBold: {
    color: colors.primary,
    fontWeight: '600',
  },
});
