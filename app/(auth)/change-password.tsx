import { useEffect, useState } from 'react';
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
import { updateSignedInUserPassword } from '../../lib/signedInPasswordUpdate';
import {
  isAal2PasswordError,
  needsMfaBeforeSensitiveUpdate,
  verifyTotpToAal2,
} from '../../lib/mfaSession';
import { colors } from '../../constants/colors';
import { markPlatformAdminAllEventsLanding, PLATFORM_ADMIN_ALL_EVENTS_HREF } from '../../lib/platformAdminNav';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { refreshUser, session } = useAuthStore();
  const mustChangePassword = !!session?.user?.user_metadata?.must_change_password;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [checkingMfa, setCheckingMfa] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const needed = await needsMfaBeforeSensitiveUpdate();
      if (!cancelled) {
        setNeedsMfa(needed);
        setCheckingMfa(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (needsMfa || (await needsMfaBeforeSensitiveUpdate())) {
        const mfa = await verifyTotpToAal2(mfaCode);
        if (!mfa.ok) {
          Alert.alert('Authenticator required', mfa.message);
          setNeedsMfa(true);
          return;
        }
        setNeedsMfa(false);
      }

      const result = await updateSignedInUserPassword(p, refreshUser);
      if (!result.ok) {
        if (isAal2PasswordError(result.message)) {
          setNeedsMfa(true);
          Alert.alert(
            'Authenticator required',
            'This account has MFA enabled. Enter the 6-digit code from your authenticator app, then try again.',
          );
          return;
        }
        Alert.alert(result.title, result.message);
        return;
      }
      const { user } = useAuthStore.getState();
      requestAnimationFrame(() => {
        if (user?.is_platform_admin) {
          markPlatformAdminAllEventsLanding();
          router.replace(PLATFORM_ADMIN_ALL_EVENTS_HREF);
        } else {
          router.replace('/(tabs)/home');
        }
      });
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
            {mustChangePassword
              ? 'You signed in with a temporary password. Set a new password to continue.'
              : 'Choose a new password for your KBM Connect account.'}
          </Text>
          {checkingMfa ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : null}
          {needsMfa ? (
            <>
              <Text style={styles.mfaHint}>
                This account has MFA. Enter the 6-digit code from your authenticator app before
                setting a new password.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Authenticator code"
                placeholderTextColor={colors.textSecondary}
                value={mfaCode}
                onChangeText={setMfaCode}
                keyboardType="number-pad"
                maxLength={6}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </>
          ) : null}
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
            disabled={loading || checkingMfa}
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
    fontSize: 24,
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
  mfaHint: {
    fontSize: 14,
    color: colors.text,
    marginBottom: 12,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  button: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
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
