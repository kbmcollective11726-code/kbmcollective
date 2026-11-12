import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useRolePreviewContext } from '../../../../hooks/useRolePreviewContext';
import { supabase } from '../../../../lib/supabase';
import { createNotificationAndPush } from '../../../../lib/notifications';
import { colors } from '../../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../../lib/eventTheme';
import { groupChatHref, navigateBackToFrom } from '../../../../lib/navReturn';
import Avatar from '../../../../components/Avatar';
import ProfileStackScreenHeader from '../../../../components/ProfileStackScreenHeader';
import { Check } from 'lucide-react-native';

type MemberOption = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
};

export default function NewGroupScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { applyEventAdmin } = useRolePreviewContext();
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '18');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const fetchStarted = useRef(false);

  const goBack = useCallback(() => {
    navigateBackToFrom(router, from, '/(tabs)/profile/groups');
  }, [router, from]);

  const fetchMembers = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data: roleData, error: roleError } = await supabase
        .from('event_members')
        .select('role, roles')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (roleError) throw roleError;
      const row = roleData as { role?: string; roles?: string[] } | null;
      const role = row?.role ?? 'attendee';
      const roles = Array.isArray(row?.roles) ? row.roles : [];
      const realAdmin =
        role === 'admin' ||
        role === 'super_admin' ||
        roles.includes('admin') ||
        roles.includes('super_admin');
      const admin = applyEventAdmin(realAdmin);
      setIsAdmin(admin);
      if (!admin) return;
      const { data: memberData, error } = await supabase
        .from('event_members')
        .select('user_id, users!inner(full_name, avatar_url)')
        .eq('event_id', currentEvent.id)
        .neq('role', 'super_admin');
      if (error) throw error;
      type MemberRow = { user_id: string; users: { full_name: string; avatar_url: string | null } | Array<{ full_name: string; avatar_url: string | null }> };
      const list = (memberData ?? []).map((r: MemberRow) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          user_id: r.user_id,
          full_name: u?.full_name ?? '',
          avatar_url: u?.avatar_url ?? null,
        };
      });
      setMembers(list ?? []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentEvent?.id, applyEventAdmin]);

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) {
      setLoading(false);
      return;
    }
    if (fetchStarted.current) return;
    fetchStarted.current = true;
    void fetchMembers();
  }, [user?.id, currentEvent?.id, fetchMembers]);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a group name.');
      return;
    }
    if (!user?.id || !currentEvent?.id || !isAdmin) return;
    setSaving(true);
    try {
      const { data: group, error: groupError } = await supabase
        .from('chat_groups')
        .insert({ event_id: currentEvent.id, name: trimmed, created_by: user.id })
        .select('id')
        .single();
      if (groupError) throw groupError;
      const groupId = (group as { id: string }).id;
      const toAdd = Array.from(new Set([user.id, ...selectedIds]));
      const rows = toAdd.map((uid) => ({ group_id: groupId, user_id: uid }));
      const { error: membersError } = await supabase.from('chat_group_members').insert(rows);
      if (membersError) throw membersError;
      for (const uid of toAdd) {
        if (uid === user.id) continue;
        createNotificationAndPush(
          uid,
          currentEvent.id,
          'system',
          `You were added to "${trimmed}"`,
          'Tap to open the group.',
          { group_id: groupId }
        ).catch(() => {});
      }
      Alert.alert('Group created', `"${trimmed}" is ready.`, [
        { text: 'Open', onPress: () => router.replace(groupChatHref(groupId, from) as never) },
        { text: 'Back to list', onPress: goBack },
      ]);
    } catch (err: unknown) {
      const e = err as { message?: string; details?: string; code?: string; hint?: string };
      const msg =
        typeof e?.message === 'string'
          ? e.message
          : err instanceof Error
            ? err.message
            : 'Could not create group.';
      const detail = [e?.code, e?.details, e?.hint].filter(Boolean).join(' — ');
      console.error('Create group error:', err);
      Alert.alert('Error creating group', detail ? `${msg}\n\n${detail}` : msg);
    } finally {
      setSaving(false);
    }
  };

  if (!user?.id || !currentEvent?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="New group" onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Select an event first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!loading && !isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="New group" onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Only event admins can create groups.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="New group" onBack={goBack} />
      {loading ? (
        <View style={styles.membersLoading}>
          <ActivityIndicator size="large" color={themeColor} />
        </View>
      ) : (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Group name</Text>
        <TextInput
          style={[styles.input, { borderColor: themeColorWithAlpha(themeColor, '30'), backgroundColor: themeFaded }]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Speakers & Organizers"
          placeholderTextColor={colors.textMuted}
          editable={!saving}
        />
        <Text style={[styles.label, { marginTop: 20 }]}>Add members</Text>
        <Text style={styles.hint}>You are automatically added. Select others to include.</Text>
        {members.map((m) => (
          <TouchableOpacity
            key={m.user_id}
            style={styles.memberRow}
            onPress={() => toggleMember(m.user_id)}
            disabled={saving}
            activeOpacity={0.7}
          >
            <Avatar uri={m.avatar_url} name={m.full_name} size={44} />
            <Text style={styles.memberName} numberOfLines={1}>
              {m.full_name}
            </Text>
            <View
              style={[
                styles.checkbox,
                selectedIds.has(m.user_id) && { backgroundColor: themeColor, borderColor: themeColor },
              ]}
            >
              {selectedIds.has(m.user_id) ? <Check size={16} color={colors.textOnPrimary} strokeWidth={3} /> : null}
            </View>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: themeColor }, saving && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.createBtnText}>Create group</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  membersLoading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  placeholderText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  memberName: { flex: 1, fontSize: 16, color: colors.text },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  createBtn: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  createBtnDisabled: { opacity: 0.7 },
  createBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
});
