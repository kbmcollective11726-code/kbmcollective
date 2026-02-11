import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { ChevronRight, Edit3, Bell, Users, LogOut, Shield, ExternalLink, Mic, Store, User } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import Avatar from '../../../components/Avatar';

export default function ProfileIndexScreen() {
  const router = useRouter();
  const { user, logout, refreshUser } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [points, setPoints] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState<number>(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [myRoles, setMyRoles] = useState<string[]>(['attendee']);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const fetchUnreadNotifications = () => {
    if (!user?.id) return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .then(({ count }) => setUnreadNotifications(count ?? 0));
  };

  useEffect(() => {
    fetchUnreadNotifications();
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchUnreadNotifications();
    }, [user?.id])
  );

  const loadStats = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      if (currentEvent?.id) {
        const [memberRes, postsRes, roleRes] = await Promise.all([
          supabase
            .from('event_members')
            .select('points')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .single(),
          supabase
            .from('posts')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .eq('is_deleted', false),
          supabase
            .from('event_members')
            .select('role, roles')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .single(),
        ]);
        setPoints(memberRes.data?.points ?? 0);
        setPostsCount(postsRes.count ?? 0);
        const data = roleRes.data as { role?: string; roles?: string[] } | null;
        const roles = data?.roles?.length ? data.roles : (data?.role ? [data.role] : ['attendee']);
        setIsEventAdmin(roles.includes('admin') || roles.includes('super_admin'));
        const selectable = roles.filter((r) => ['attendee', 'speaker', 'vendor'].includes(r));
        setMyRoles(selectable.length ? selectable : ['attendee']);
      } else {
        setPoints(null);
        setPostsCount(0);
        setIsEventAdmin(false);
        setMyRoles(['attendee']);
      }
    } catch (err) {
      console.error('Profile stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [user?.id, currentEvent?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshUser(), loadStats()]);
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  const ROLE_OPTIONS = [
    { key: 'attendee', label: 'Attendee', icon: User },
    { key: 'speaker', label: 'Speaker', icon: Mic },
    { key: 'vendor', label: 'Vendor', icon: Store },
  ] as const;

  const toggleRole = (key: string) => {
    setMyRoles((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]
    );
  };

  const handleSaveRoles = async () => {
    if (!currentEvent?.id || !user?.id) return;
    if (myRoles.length === 0) {
      Alert.alert('Select at least one role', 'e.g. Attendee, Speaker, or Vendor.');
      return;
    }
    setRoleSaving(true);
    try {
      const { data: existing } = await supabase
        .from('event_members')
        .select('roles, role')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .single();
      const existingRoles = (existing as { roles?: string[]; role?: string } | null)?.roles ?? 
        ((existing as { role?: string })?.role ? [(existing as { role: string }).role] : ['attendee']);
      const adminRoles = existingRoles.filter((r) => r === 'admin' || r === 'super_admin');
      const newRoles = [...new Set([...myRoles, ...adminRoles])];
      const { error } = await supabase
        .from('event_members')
        .update({ roles: newRoles })
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id);
      if (error) throw error;
      setShowRoleModal(false);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update roles.');
    } finally {
      setRoleSaving(false);
    }
  };

  const roleLabel = (r: string) =>
    ROLE_OPTIONS.find((o) => o.key === r)?.label ?? (r === 'admin' || r === 'super_admin' ? 'Admin' : r);

  if (!user) return null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.push('/profile/edit')}
            style={styles.avatarTouchable}
            activeOpacity={0.8}
          >
            <Avatar uri={user.avatar_url} name={user.full_name} size={88} />
            <Text style={styles.avatarHint}>Tap to add or change photo</Text>
          </TouchableOpacity>
          <Text style={styles.name}>{user.full_name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          {(user.title || user.company) && (
            <Text style={styles.subtitle}>
              {[user.title, user.company].filter(Boolean).join(' · ')}
            </Text>
          )}
          {user.bio ? (
            <Text style={styles.bio} numberOfLines={3}>
              {user.bio}
            </Text>
          ) : null}
          {user.linkedin_url ? (
            <TouchableOpacity
              style={styles.linkedinBtn}
              onPress={() => {
                const url = user.linkedin_url!;
                const toOpen = url.startsWith('http') ? url : `https://${url}`;
                Linking.openURL(toOpen).catch(() =>
                  Alert.alert('Error', 'Could not open LinkedIn.')
                );
              }}
              activeOpacity={0.7}
            >
              <ExternalLink size={18} color={colors.primary} />
              <Text style={styles.linkedinText}>LinkedIn profile</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {currentEvent && (
          <>
            <View style={styles.stats}>
              {loading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  {points !== null && (
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{points}</Text>
                      <Text style={styles.statLabel}>points</Text>
                    </View>
                  )}
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{postsCount}</Text>
                    <Text style={styles.statLabel}>posts</Text>
                  </View>
                </>
              )}
            </View>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => !isEventAdmin && setShowRoleModal(true)}
              activeOpacity={isEventAdmin ? 1 : 0.7}
              disabled={isEventAdmin}
            >
              <Text style={styles.roleLabel}>My roles for this event</Text>
              <View style={styles.roleRow}>
                <Text style={styles.roleValue} numberOfLines={1}>
                  {myRoles.length ? myRoles.map(roleLabel).join(', ') : 'None'}
                </Text>
                {!isEventAdmin && <ChevronRight size={20} color={colors.textMuted} />}
              </View>
              {isEventAdmin && (
                <Text style={styles.roleHint}>Admins: change roles in Event admin → Manage members</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <Modal visible={showRoleModal} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => !roleSaving && setShowRoleModal(false)}>
            <Pressable style={styles.roleModalContent} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.roleModalTitle}>Select your roles</Text>
              <Text style={styles.roleModalSubtitle}>You can be a presenter and vendor (or more). Pick all that apply.</Text>
              {ROLE_OPTIONS.map(({ key, label, icon: Icon }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.roleOption, myRoles.includes(key) && styles.roleOptionActive]}
                  onPress={() => toggleRole(key)}
                  disabled={roleSaving}
                >
                  <Icon size={22} color={myRoles.includes(key) ? colors.textOnPrimary : colors.textSecondary} />
                  <Text style={[styles.roleOptionText, myRoles.includes(key) && styles.roleOptionTextActive]}>
                    {label}
                  </Text>
                  {myRoles.includes(key) && <Text style={styles.roleOptionCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.roleModalClose, styles.roleModalSave]}
                onPress={handleSaveRoles}
                disabled={roleSaving || myRoles.length === 0}
              >
                <Text style={[styles.roleModalCloseText, styles.roleModalSaveText]}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.roleModalClose}
                onPress={() => setShowRoleModal(false)}
                disabled={roleSaving}
              >
                <Text style={styles.roleModalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/profile/edit')}
            activeOpacity={0.7}
          >
            <Edit3 size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Edit profile</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/profile/notifications')}
            activeOpacity={0.7}
          >
            <Bell size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Notifications</Text>
            {unreadNotifications > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
              </View>
            )}
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(tabs)/community')}
            activeOpacity={0.7}
          >
            <Users size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Community</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/profile/admin')}
            activeOpacity={0.7}
          >
            <Shield size={22} color={isEventAdmin && currentEvent ? colors.primary : colors.textSecondary} />
            <Text style={styles.menuText}>Event admin</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut size={22} color={colors.danger} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarTouchable: {
    alignItems: 'center',
  },
  avatarHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  linkedinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  linkedinText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 24,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 24,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  notifBadge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  notifBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutText: {
    fontSize: 16,
    color: colors.danger,
    fontWeight: '600',
  },
  roleCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  roleHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
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
  roleModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  roleModalSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
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
  roleOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  roleOptionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  roleOptionTextActive: {
    color: colors.textOnPrimary,
  },
  roleOptionCheck: {
    fontSize: 18,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  roleModalSave: { backgroundColor: colors.primary },
  roleModalSaveText: { color: '#fff', fontWeight: '600' },
  roleModalClose: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  roleModalCloseText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
