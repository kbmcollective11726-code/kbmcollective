import { useEffect, useState } from 'react';
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
import { User, Mic, Store, Shield, ChevronRight } from 'lucide-react-native';

type Row = { user_id: string; full_name: string; avatar_url: string | null; role: string; roles: string[]; points: number };

const ROLE_OPTIONS = [
  { key: 'attendee', label: 'Attendee', icon: User },
  { key: 'speaker', label: 'Speaker', icon: Mic },
  { key: 'vendor', label: 'Vendor', icon: Store },
  { key: 'admin', label: 'Admin', icon: Shield },
] as const;

export default function AdminMembersScreen() {
  const { currentEvent } = useEventStore();
  const { user: currentUser } = useAuthStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Row | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);

  const fetchMembers = async () => {
    if (!currentEvent?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('event_members')
        .select('user_id, role, roles, points, users!inner(full_name, avatar_url)')
        .eq('event_id', currentEvent.id)
        .order('points', { ascending: false });
      if (error) throw error;
      const list: Row[] = (data ?? []).map((r: any) => {
        const roles = Array.isArray(r.roles) && r.roles.length ? r.roles : (r.role ? [r.role] : ['attendee']);
        return {
          user_id: r.user_id,
          full_name: r.users?.full_name ?? 'Unknown',
          avatar_url: r.users?.avatar_url ?? null,
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

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  };

  const toggleMemberRole = (member: Row, roleKey: string) => {
    const hasAdmin = member.roles.includes('admin') || member.roles.includes('super_admin');
    const newRoles = member.roles.includes(roleKey)
      ? member.roles.filter((r) => r !== roleKey)
      : [...member.roles, roleKey];
    if (newRoles.length === 0) return;
    const isSelf = member.user_id === currentUser?.id;
    const removingAdmin = (roleKey === 'admin' || roleKey === 'super_admin') && isSelf;
    if (removingAdmin && hasAdmin) {
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

  const doSaveRoles = async (member: Row, newRoles: string[]) => {
    if (!currentEvent?.id) return;
    setRoleSaving(true);
    try {
      const { error } = await supabase
        .from('event_members')
        .update({ roles: newRoles })
        .eq('event_id', currentEvent.id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      const updated = { ...member, roles: newRoles, role: newRoles[0] ?? member.role };
      setRows((prev) =>
        prev.map((r) => (r.user_id === member.user_id ? updated : r))
      );
      setSelectedMember((prev) => (prev?.user_id === member.user_id ? updated : prev));
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update roles.');
    } finally {
      setRoleSaving(false);
    }
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
            onPress={() => setSelectedMember(item)}
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
                  <Text style={styles.modalCurrentRole}>
                    Current: {rolesLabel(selectedMember.roles)}
                  </Text>
                </View>
                <Text style={styles.modalTitle}>Roles (select all that apply)</Text>
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
  modalCurrentRole: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },
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
