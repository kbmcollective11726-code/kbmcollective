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
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { updateSignedInUserPassword } from '../../../lib/signedInPasswordUpdate';
import { colors } from '../../../constants/colors';

const VERIFY_TIMEOUT_MS = 30000;

export default function ProfileChangePasswordScreen() {
  const router = useRouter();
  const { refreshUser, user } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      Alert.alert(
        'Email sign-in required',
        'This screen is for accounts that use email and password. If you signed in another way, contact support to change your password.',
      );
      return;
    }

    const cur = currentPassword.trim();
    const p = password.trim();
    const c = confirm.trim();

    if (!cur) {
      Alert.alert('Required', 'Enter your current password.');
      return;
    }
    if (p.length < 8) {
      Alert.alert('Too short', 'New password must be at least 8 characters.');
      return;
    }
    if (p !== c) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    if (p === cur) {
      Alert.alert('Same password', 'Choose a new password that’s different from your current one.');
      return;
    }

    setLoading(true);
    try {
      const verifyPromise = supabase.auth.signInWithPassword({
        email,
        password: cur,
      });
      const signResult = await Promise.race([
        verifyPromise,
        new Promise<{ data: { session: null; user: null }; error: { message: string } }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                data: { session: null, user: null },
                error: { message: 'Could not verify password in time. Check your connection and try again.' },
              }),
            VERIFY_TIMEOUT_MS,
          ),
        ),
      ]);

      if (signResult.error) {
        const msg = signResult.error.message?.toLowerCase() ?? '';
        if (msg.includes('invalid') || msg.includes('credential')) {
          Alert.alert(
            'Wrong password',
            'That doesn’t match your current password. Try again, or sign out and use Forgot password on the sign-in screen.',
          );
        } else {
          Alert.alert('Could not verify', signResult.error.message ?? 'Something went wrong.');
        }
        return;
      }

      if (!signResult.data?.session) {
        Alert.alert('Could not verify', 'Please try again.');
        return;
      }

      useAuthStore.setState({ session: signResult.data.session });

      const result = await updateSignedInUserPassword(p, refreshUser);
      if (!result.ok) {
        Alert.alert(result.title, result.message);
        return;
      }

      setCurrentPassword('');
      setPassword('');
      setConfirm('');
      Alert.alert('Password updated', 'Your password has been changed. You’re still signed in on this device.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Change password</Text>
          <Text style={styles.subtitle}>
            Enter your current password, then choose a new one. Everything stays in the app — no email needed.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Current password"
            placeholderTextColor={colors.textSecondary}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            textContentType="password"
          />
          <TextInput
            style={styles.input}
            placeholder="New password (min 8 characters)"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            textContentType="newPassword"
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            placeholderTextColor={colors.textSecondary}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            textContentType="newPassword"
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Update password</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>
            Forgot your current password? <Text style={styles.hintBold}>Sign out</Text>, then tap{' '}
            <Text style={styles.hintBold}>Forgot password?</Text> on the sign-in screen.
          </Text>
        </ScrollView>
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
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 52,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    marginTop: 20,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  hintBold: {
    fontWeight: '600',
    color: colors.text,
  },
});
