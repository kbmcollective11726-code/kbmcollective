import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, X, UserX } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import Toast from 'react-native-toast-message';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');

type UserRow = { id: string; email: string | null; full_name: string | null };

export default function AdminDeleteUserScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isPlatformAdmin = user?.is_platform_admin === true;

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name')
        .order('email', { ascending: true, nullsFirst: false });
      if (error) throw error;
      setUsers((data ?? []) as UserRow[]);
    } catch (err) {
      console.error('Fetch users error:', err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPlatformAdmin) fetchUsers();
  }, [isPlatformAdmin]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  const handleDelete = (target: UserRow) => {
    if (target.id === user?.id) {
      Alert.alert('Not allowed', 'You cannot delete your own account.');
      return;
    }
    Alert.alert(
      'Delete account',
      `Permanently delete "${target.full_name || target.email || target.id}"? All their data (posts, memberships, messages, etc.) will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(target.id);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              if (!token || !SUPABASE_URL) {
                throw new Error('Not signed in or missing Supabase URL.');
              }
              const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ user_id: target.id }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error((body as { error?: string }).error || `Request failed (${res.status}).`);
              }
              Toast.show({ type: 'success', text1: 'Account deleted' });
              setUsers((prev) => prev.filter((u) => u.id !== target.id));
            } catch (err) {
              Toast.show({
                type: 'error',
                text1: err instanceof Error ? err.message : 'Failed to delete account.',
              });
            } finally {
              setDeletingId(null);
            }
          },
        },
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

  if (!isPlatformAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Only platform admins can delete user accounts.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Search size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name or email…"
          placeholderTextColor={colors.textMuted}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <X size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.hint}>Tap a user to permanently delete their account and all associated data.</Text>
      {loading ? (
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {filteredUsers.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.empty}>No users found.</Text>
            </View>
          ) : (
            filteredUsers.map((u) => (
              <View key={u.id} style={styles.card}>
                <View style={styles.cardBody}>
                  <Text style={styles.name}>{u.full_name || u.email || 'No name'}</Text>
                  {u.email ? <Text style={styles.email}>{u.email}</Text> : null}
                </View>
                <TouchableOpacity
                  style={[styles.deleteBtn, deletingId === u.id && styles.deleteBtnDisabled]}
                  onPress={() => handleDelete(u)}
                  disabled={deletingId !== null}
                >
                  {deletingId === u.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <UserX size={20} color={colors.danger} />
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  scrollContent: { padding: 16, paddingBottom: 32 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  empty: { fontSize: 15, color: colors.textMuted },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardBody: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 2 },
  email: { fontSize: 13, color: colors.textMuted },
  deleteBtn: { padding: 8 },
  deleteBtnDisabled: { opacity: 0.6 },
});
