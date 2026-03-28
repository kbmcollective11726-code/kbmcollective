import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { supabase, supabaseUrl, refreshSessionIfNeeded } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';

const CONFIRM_TEXT = 'DELETE';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmInput.trim().toUpperCase() === CONFIRM_TEXT;

  const handleDeleteAccount = async () => {
    if (!user?.id || !canDelete || deleting) return;

    setDeleting(true);
    try {
      const url = (supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
      if (!url) throw new Error('Missing configuration.');

      const doRequest = async (): Promise<Response> => {
        await refreshSessionIfNeeded();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Not signed in.');
        return fetch(`${url}/functions/v1/delete-user`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: user.id }),
        });
      };

      let res = await doRequest();
      if (res.status === 401) {
        await refreshSessionIfNeeded();
        res = await doRequest();
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (body as { error?: string }).error;
        if (res.status === 401) {
          throw new Error(msg || 'Session expired. Please log out and log back in, then try again.');
        }
        throw new Error(msg || `Request failed (${res.status}).`);
      }
      await logout();
      router.replace('/(auth)/login');
    } catch (err) {
      Alert.alert(
        'Could not delete account',
        err instanceof Error ? err.message : 'Something went wrong. Try again later.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const showFinalConfirm = () => {
    if (!canDelete) return;
    Alert.alert(
      'Permanently delete your account?',
      'Your account and all associated data (profile, posts, event memberships, messages, etc.) will be permanently removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete my account', style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Sign in to continue.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Trash2 size={48} color={colors.danger} strokeWidth={1.5} />
        </View>
        <Text style={styles.title}>Delete account</Text>
        <Text style={styles.description}>
          Permanently delete your account and all data associated with it. This includes your profile, posts, event memberships, group memberships, notifications, and any other data we store. This action cannot be undone.
        </Text>
        <Text style={styles.warning}>
          To confirm, type <Text style={styles.confirmLabel}>{CONFIRM_TEXT}</Text> below.
        </Text>
        <TextInput
          style={styles.input}
          value={confirmInput}
          onChangeText={setConfirmInput}
          placeholder={CONFIRM_TEXT}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!deleting}
        />
        <TouchableOpacity
          style={[
            styles.deleteButton,
            (!canDelete || deleting) && styles.deleteButtonDisabled,
          ]}
          onPress={showFinalConfirm}
          disabled={!canDelete || deleting}
          activeOpacity={0.8}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.deleteButtonText}>Permanently delete my account</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => router.back()}
          disabled={deleting}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 24, paddingBottom: 48 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 16, color: colors.textSecondary },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.dangerLight + '40',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  warning: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  confirmLabel: {
    fontFamily: 'monospace',
    fontWeight: '700',
    color: colors.danger,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 20,
    backgroundColor: colors.surface,
  },
  deleteButton: {
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginBottom: 12,
  },
  deleteButtonDisabled: { opacity: 0.5 },
  deleteButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 16, color: colors.textSecondary },
});
