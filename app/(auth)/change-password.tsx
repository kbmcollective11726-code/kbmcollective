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
import { supabase } from '../../lib/supabase';
import { colors } from '../../constants/colors';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { refreshUser } = useAuthStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const p = password.trim();
    const c = confirm.trim();
    if (p.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (p !== c) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: p,
        data: { must_change_password: false },
      });
      if (error) {
        Alert.alert('Update failed', error.message);
        setLoading(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session) useAuthStore.setState({ session });
      await refreshUser();
      const user = useAuthStore.getState().user;
      if (user?.is_platform_admin) {
        router.replace('/profile/admin-all-events');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <View style={styles.inner}>
          <Text style={styles.title}>Change your password</Text>
          <Text style={styles.subtitle}>
            You signed in with a temporary password. Set a new password to continue.
          </Text>
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
              <Text style={styles.buttonText}>Set password and continue</Text>
            )}
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
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
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
});
