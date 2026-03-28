import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEventStore } from '../../../stores/eventStore';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import Avatar from '../../../components/Avatar';
import { User, Mic, Store, Shield, ChevronRight, UserMinus, UserX } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');

type Row = { user_id: string; full_name: string; avatar_url: string | null; email: string | null; role: string; roles: string[]; points: number };

const ROLE_OPTIONS: { key: string; label: string; icon: typeof User }[] = [
  { key: 'attendee', label: 'Attendee', icon: User },
  { key: 'speaker', label: 'Speaker', icon: Mic },
  { key: 'vendor', label: 'Vendor', icon: Store },
  { key: 'admin', label: 'Admin', icon: Shield },
];

export default function AdminMembersScreen() {
  const { currentEvent } = useEventStore();
  const { user: currentUser } = useAuthStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Row | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [canChangeRoles, setCanChangeRoles] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const isPlatformAdmin = currentUser?.is_platform_admin === true;

  const fetchCurrentUserRole = useCallback(async () => {
    if (!currentEvent?.id || !currentUser?.id) {
      setCanChangeRoles(!!currentUser?.is_platform_admin);
      return;
    }
    const { data } = await supabase
      .from('event_members')
      .select('role, roles')
      .eq('event_id', currentEvent.id)
      .eq('user_id', currentUser.id)
      .single();
    const row = data as { role?: string; roles?: string[] } | null;
    const role = row?.role ?? 'attendee';
    const roles = Array.isArray(row?.roles) ? row.roles : [];
    const isEventAdmin = role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin');
    setCanChangeRoles(!!isEventAdmin || !!currentUser?.is_platform_admin);
  }, [currentEvent?.id, currentUser?.id, currentUser?.is_platform_admin]);

  useEffect(() => {
    fetchCurrentUserRole();
  }, [fetchCurrentUserRole]);

  const fetchMembers = async () => {
    if (!currentEvent?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('event_members')
        .select('user_id, role, roles, points, users!inner(full_name, avatar_url, email)')
        .eq('event_id', currentEvent.id)
        .order('points', { ascending: false });
      if (error) throw error;
      const list: Row[] = (data ?? []).map((r: any) => {
        const roles = Array.isArray(r.roles) && r.roles.length ? r.roles : (r.role ? [r.role] : ['attendee']);
        return {
          user_id: r.user_id,
          full_name: r.users?.full_name ?? 'Unknown',
          avatar_url: r.users?.avatar_url ?? null,
          email: r.users?.email ?? null,
          role: r.role ?? roles[0] ?? 'attendee',
          roles,
          points: r.points ?? 0,
        };
      });
      setRows(list);
    } catch (err) {
      console.error(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchMembers().catch(() => {});
    }, [currentEvent?.id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  };

  const toggleMemberRole = (member: Row, roleKey: string) => {
    const hasRole = member.roles.includes(roleKey);
    const newRoles = hasRole
      ? member.roles.filter((r) => r !== roleKey)
      : [...member.roles, roleKey];
    if (newRoles.length === 0) return;
    const isSelf = member.user_id === currentUser?.id;
    const hadAdmin = member.roles.includes('admin') || member.roles.includes('super_admin');
    const removingAdmin = (roleKey === 'admin' || roleKey === 'super_admin') && hasRole && isSelf;
    if (removingAdmin && hadAdmin) {
      Alert.alert(
        'Remove your admin role?',
        'You will lose admin access for this event. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes', onPress: () => doSaveRoles(member, newRoles) },
        ]
      );
      return;
    }
    doSaveRoles(member, newRoles);
  };

  const primaryRole = (roles: string[]) =>
    roles.includes('admin') ? 'admin' : roles.includes('vendor') ? 'vendor' : roles.includes('speaker') ? 'speaker' : roles[0] ?? 'attendee';

  const doSaveRoles = async (member: Row, newRoles: string[]) => {
    if (!currentEvent?.id) return;
    setRoleSaving(true);
    try {
      const primary = primaryRole(newRoles);
      const { error } = await supabase
        .from('event_members')
        .update({ role: primary, roles: newRoles })
        .eq('event_id', currentEvent.id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      const updated = { ...member, roles: newRoles, role: primary };
      setRows((prev) =>
        prev.map((r) => (r.user_id === member.user_id ? updated : r))
      );
      setSelectedMember((prev) => (prev?.user_id === member.user_id ? updated : prev));
    } catch (err) {
      const e = err as { message?: string; details?: string; code?: string; hint?: string; error?: { message?: string } };
      const msg =
        e?.message ??
        e?.error?.message ??
        (err instanceof Error ? err.message : null) ??
        'Could not update role.';
      const extra = [e?.details, e?.hint, e?.code].filter(Boolean).join(' · ');
      if (__DEV__) console.error('Role update error:', err);
      Alert.alert('Error', String(msg).trim() + (extra ? `\n\n${extra}` : ''));
    } finally {
      setRoleSaving(false);
    }
  };

  const handleRemoveFromEvent = (member: Row) => {
    if (member.user_id === currentUser?.id) {
      Alert.alert('Not allowed', 'You cannot remove yourself from the event.');
      return;
    }
    Alert.alert(
      'Remove from event',
      `Remove "${member.full_name}" from this event? They will need to re-enter the event code to rejoin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!currentEvent?.id) return;
            setRemovingUserId(member.user_id);
            try {
              const { error } = await supabase
                .from('event_members')
                .delete()
                .eq('event_id', currentEvent.id)
                .eq('user_id', member.user_id);
              if (error) throw error;
              setRows((prev) => prev.filter((r) => r.user_id !== member.user_id));
              setSelectedMember(null);
              Toast.show({ type: 'success', text1: 'Removed from event' });
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Could not remove member.');
            } finally {
              setRemovingUserId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeleteFromSystem = (member: Row) => {
    if (member.user_id === currentUser?.id) {
      Alert.alert('Not allowed', 'You cannot delete your own account.');
      return;
    }
    if (!isPlatformAdmin) return;
    Alert.alert(
      'Delete account',
      `Permanently delete "${member.full_name || member.email || member.user_id}"? All their data (posts, memberships, messages, etc.) will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingUserId(member.user_id);
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
                body: JSON.stringify({ user_id: member.user_id }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error((body as { error?: string }).error || `Request failed (${res.status}).`);
              }
              Toast.show({ type: 'success', text1: 'Account deleted' });
              setRows((prev) => prev.filter((r) => r.user_id !== member.user_id));
              setSelectedMember(null);
            } catch (err) {
              Toast.show({
                type: 'error',
                text1: err instanceof Error ? err.message : 'Failed to delete account.',
              });
            } finally {
              setDeletingUserId(null);
            }
          },
        },
      ]
    );
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}><Text style={styles.subtitle}>Select an event first.</Text></View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const roleLabel = (r: string) =>
    ROLE_OPTIONS.find((o) => o.key === r)?.label ?? (r === 'super_admin' ? 'Admin' : r);
  const rolesLabel = (roles: string[]) => roles.map(roleLabel).join(', ') || 'Attendee';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              if (!canChangeRoles) {
                Alert.alert(
                  'Change role',
                  'Only event admins and super admins can change member roles.',
                  [{ text: 'OK' }]
                );
                return;
              }
              setSelectedMember(item);
            }}
            activeOpacity={0.7}
          >
            <Avatar uri={item.avatar_url} name={item.full_name} size={44} />
            <View style={styles.info}>
              <Text style={styles.name}>{item.full_name}</Text>
              <Text style={styles.meta}>{rolesLabel(item.roles)} · {item.points} pts</Text>
            </View>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selectedMember} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !roleSaving && setSelectedMember(null)}
        >
          <Pressable style={styles.roleModalContent} onPress={(e) => e.stopPropagation()}>
            {selectedMember && (
              <>
                <View style={styles.modalHeader}>
                  <Avatar
                    uri={selectedMember.avatar_url}
                    name={selectedMember.full_name}
                    size={48}
                  />
                  <Text style={styles.modalName}>{selectedMember.full_name}</Text>
                  {selectedMember.email ? (
                    <Text style={styles.modalEmail}>{selectedMember.email}</Text>
                  ) : null}
                  <Text style={styles.modalCurrentRole}>
                    Current: {rolesLabel(selectedMember.roles)}
                  </Text>
                </View>
                <Text style={styles.modalTitle}>Roles (select all that apply)</Text>
                <Text style={styles.modalSubtitle}>e.g. Speaker + Vendor</Text>
                {ROLE_OPTIONS.map(({ key, label, icon: Icon }) => (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.roleOption,
                      selectedMember.roles.includes(key) && styles.roleOptionActive,
                    ]}
                    onPress={() => toggleMemberRole(selectedMember, key)}
                    disabled={roleSaving}
                  >
                    <Icon
                      size={22}
                      color={
                        selectedMember.roles.includes(key)
                          ? colors.textOnPrimary
                          : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.roleOptionText,
                        selectedMember.roles.includes(key) && styles.roleOptionTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                    {selectedMember.roles.includes(key) && (
                      <Text style={styles.roleOptionCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
                {canChangeRoles && selectedMember.user_id !== currentUser?.id ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.removeFromEventBtn]}
                    onPress={() => handleRemoveFromEvent(selectedMember)}
                    disabled={roleSaving || removingUserId !== null}
                  >
                    {removingUserId === selectedMember.user_id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <UserMinus size={20} color={colors.danger} />
                    )}
                    <Text style={styles.removeFromEventText}>Remove from event</Text>
                  </TouchableOpacity>
                ) : null}
                {isPlatformAdmin && selectedMember.user_id !== currentUser?.id ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.deleteFromSystemBtn]}
                    onPress={() => handleDeleteFromSystem(selectedMember)}
                    disabled={roleSaving || deletingUserId !== null}
                  >
                    {deletingUserId === selectedMember.user_id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <UserX size={20} color={colors.danger} />
                    )}
                    <Text style={styles.deleteFromSystemText}>Delete from system</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.modalClose}
                  onPress={() => setSelectedMember(null)}
                  disabled={roleSaving}
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  info: { marginLeft: 12, flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  roleModalContent: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 24,
  },
  modalHeader: { alignItems: 'center', marginBottom: 20 },
  modalName: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 },
  modalEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  modalCurrentRole: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 1,
  },
  removeFromEventBtn: { backgroundColor: colors.surface, borderColor: colors.danger },
  removeFromEventText: { fontSize: 16, fontWeight: '600', color: colors.danger },
  deleteFromSystemBtn: { backgroundColor: colors.surface, borderColor: colors.danger },
  deleteFromSystemText: { fontSize: 16, fontWeight: '600', color: colors.danger },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleOptionText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  roleOptionTextActive: { color: colors.textOnPrimary },
  roleOptionCheck: { fontSize: 18, color: colors.textOnPrimary, fontWeight: '700' },
  modalClose: { marginTop: 16, paddingVertical: 14, alignItems: 'center' },
  modalCloseText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
});
