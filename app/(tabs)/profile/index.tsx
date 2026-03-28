import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Modal,
  Dimensions,
  AppState,
  AppStateStatus,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { User, Mic, Store, ExternalLink, LogOut, Calendar, Building2, ChevronRight, Users, Edit3, Bell, Shield, MessageCircle, Trash2, Lock } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { addDebugLog } from '../../../lib/debugLog';
import { colors } from '../../../constants/colors';
import Avatar from '../../../components/Avatar';

const RESUME_REFETCH_DEBOUNCE_MS = 12000;

export default function ProfileScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = useIsFocused();
  const { user, refreshUser, logout } = useAuthStore();
  const { currentEvent } = useEventStore();
  const lastResumeRefetchAt = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [myRoles, setMyRoles] = useState<string[]>(['attendee']);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const fetchPointsAndRole = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (currentEvent?.id) {
      // Run each query so one failure doesn't take down the whole stats block
      let pointsOk = false;
      let postsOk = false;
      let roleOk = false;
      try {
        const memberRes = await supabase.from('event_members').select('points').eq('event_id', currentEvent.id).eq('user_id', user.id).maybeSingle();
        if (!memberRes.error) {
          setPoints(memberRes.data?.points ?? 0);
          pointsOk = true;
        }
      } catch (_) {}
      try {
        let postsCount = 0;
        const postsRes = await supabase.from('posts').select('id', { count: 'exact', head: true }).eq('event_id', currentEvent.id).eq('user_id', user.id).eq('is_deleted', false);
        if (!postsRes.error && postsRes.count != null) {
          postsCount = postsRes.count;
        } else {
          // Fallback: some setups fail on count header; fetch ids and use length so posts always show
          const { data: postIds } = await supabase.from('posts').select('id').eq('event_id', currentEvent.id).eq('user_id', user.id).eq('is_deleted', false).limit(500);
          postsCount = postIds?.length ?? 0;
        }
        setPostsCount(postsCount);
        postsOk = true;
      } catch (e) {
        if (__DEV__) console.warn('Profile posts count error:', e);
      }
      try {
        const roleRes = await supabase.from('event_members').select('role, roles').eq('event_id', currentEvent.id).eq('user_id', user.id).maybeSingle();
        if (!roleRes.error) {
          const data = roleRes.data as { role?: string; roles?: string[] } | null;
          if (data) {
            const role = data.role ?? 'attendee';
            const roles = Array.isArray(data.roles) ? data.roles : [];
            setIsEventAdmin(role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
            setMyRoles(['attendee', 'speaker', 'vendor'].includes(role) ? [role] : ['attendee']);
          } else {
            // Platform admin viewing an event they're not a member of: still give admin access
            setIsEventAdmin(!!user?.is_platform_admin);
            setMyRoles(['attendee']);
          }
          roleOk = true;
        }
      } catch (_) {}
      if (!pointsOk) setPoints(0);
      if (!postsOk) setPostsCount(0);
      if (!roleOk) {
        setMyRoles(['attendee']);
        setIsEventAdmin(!!user?.is_platform_admin);
      }
      return pointsOk || postsOk || roleOk;
    }
    setPoints(null);
    setPostsCount(0);
    setIsEventAdmin(false);
    setMyRoles(['attendee']);
    return true;
  }, [user?.id, currentEvent?.id]);

  const loadInProgressRef = useRef(false);
  const autoRetryScheduledRef = useRef(false);
  const mountedRef = useRef(false);
  const loadStats = useCallback(async () => {
    if (!user?.id) {
      if (__DEV__) console.log('[Profile] loadStats skipped — no user');
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (loadInProgressRef.current) {
      if (__DEV__) console.log('[Profile] loadStats skipped — load already in progress');
      return;
    }
    if (__DEV__) console.log('[Profile] loadStats starting');
    loadInProgressRef.current = true;
    setFetchError(null);
    setFetchErrorDetail(null);
    addDebugLog('Profile', 'Load started');
    try {
      const ok = await withRetryAndRefresh(() => fetchPointsAndRole());
      if (ok) {
        autoRetryScheduledRef.current = false;
        setFetchError(null);
        setFetchErrorDetail(null);
      } else {
        if (__DEV__) console.warn('[Profile] loadStats returned false (one or more requests failed)');
        setFetchError('Error - page not loading');
        setFetchErrorDetail('One or more requests failed');
      }
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      addDebugLog('Profile', 'Load failed', msg);
      if (__DEV__) console.warn('[Profile] loadStats error:', msg, err);
      setFetchError('Error - page not loading');
      setFetchErrorDetail(msg);
    } finally {
      loadInProgressRef.current = false;
      setLoading(false);
    }
  }, [user?.id, fetchPointsAndRole]);


  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (mountedRef.current) return;
    mountedRef.current = true;
    setFetchError(null);
    setLoading(true);
    loadStats().finally(() => setLoading(false));
  }, [user?.id, currentEvent?.id, loadStats]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        loadInProgressRef.current = false;
        loadStats().catch(() => {});
      }
    }, [user?.id, loadStats])
  );

  // When app comes back from background: wait for root’s refresh, then load (so token is valid and data loads).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || !user?.id) return;
      const now = Date.now();
      if (now - lastResumeRefetchAt.current < RESUME_REFETCH_DEBOUNCE_MS) return;
      lastResumeRefetchAt.current = now;
      loadInProgressRef.current = false;
      refreshSessionIfNeeded()
        .catch(() => {})
        .finally(() => loadStats().catch(() => {}));
    });
    return () => sub.remove();
  }, [user?.id, loadStats]);

  const screenLoadTimeoutMs = 30000; // show error after 30s, then auto-retry once
  const loadingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    loadingStartRef.current = Date.now();
    const t = setTimeout(() => {
      if (loadingStartRef.current !== null && Date.now() - loadingStartRef.current >= screenLoadTimeoutMs) {
        addDebugLog('Profile', 'Load timed out', 'Request never completed — check network or Supabase');
        loadInProgressRef.current = false;
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
        if (!autoRetryScheduledRef.current && user?.id) {
          autoRetryScheduledRef.current = true;
          setTimeout(() => {
            loadStats().catch(() => {});
          }, 2000);
        }
      }
    }, screenLoadTimeoutMs);
    return () => clearTimeout(t);
  }, [loading, user?.id, loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    addDebugLog('Profile', 'Pull-to-refresh started');
    if (__DEV__) Toast.show({ type: 'info', text1: 'Refreshing...', visibilityTime: 1500 });
    try {
      await refreshSessionIfNeeded();
      await refreshUser();
      await loadStats().catch(() => loadStats());
      addDebugLog('Profile', 'Pull-to-refresh finished');
      if (__DEV__) Toast.show({ type: 'success', text1: 'Refresh done', visibilityTime: 2000 });
    } catch (e) {
      const msg = getErrorMessage(e);
      addDebugLog('Profile', 'Pull-to-refresh failed', msg);
      if (__DEV__) Toast.show({ type: 'error', text1: 'Refresh failed', text2: msg.slice(0, 50), visibilityTime: 4000 });
      setFetchError('Error - page not loading');
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/(auth)/login');
    } finally {
      setLoggingOut(false);
    }
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
    // Users cannot remove their own admin role via Profile; only an event admin can do that
    const { data: roleData } = await supabase.from('event_members').select('role, roles').eq('event_id', currentEvent.id).eq('user_id', user.id).maybeSingle();
    if (!roleData) {
      Alert.alert('Not a member', 'You are viewing this event as a platform admin. Use Event admin → Manage members to manage this event.');
      return;
    }
    const currentRoles = Array.isArray(roleData.roles) ? roleData.roles : (roleData.role ? [roleData.role] : []);
    const hasAdmin = currentRoles.includes('admin') || currentRoles.includes('super_admin');
    const savingAdmin = myRoles.includes('admin') || myRoles.includes('super_admin');
    if (hasAdmin && !savingAdmin) {
      Alert.alert('Admin role', 'Only an event admin can change or remove your admin role. Go to Event admin → Manage members.');
      return;
    }
    setRoleSaving(true);
    try {
      const newRoles = [...myRoles];
      const newRole = newRoles[0] ?? 'attendee';
      const { error } = await supabase
        .from('event_members')
        .update({ role: newRole, roles: newRoles })
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id);
      if (error) throw error;
      setShowRoleModal(false);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update role.');
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
        contentContainerStyle={[styles.content, { minHeight: Dimensions.get('window').height + 2 }]}
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
              {fetchError ? (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={[styles.statLabel, { marginBottom: 4 }]}>Error - page not loading</Text>
                  {fetchErrorDetail ? (
                    <Text style={[styles.statLabel, { fontSize: 10, color: colors.textMuted, marginBottom: 4, fontStyle: 'italic' }]} numberOfLines={2}>
                      {fetchErrorDetail}
                    </Text>
                  ) : null}
                  <Text style={[styles.statLabel, { fontSize: 11, color: colors.textMuted, marginBottom: 8 }]}>Pull down to refresh or tap Try again.</Text>
                  {fetchErrorDetail?.toLowerCase().includes('timed out') ? (
                    <Text style={[styles.statLabel, { fontSize: 11, color: colors.textMuted, marginBottom: 8, fontStyle: 'italic' }]}>
                      Check Metro console or try: npx expo start --tunnel
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={async () => {
                      setFetchError(null);
                      setFetchErrorDetail(null);
                      setLoading(true);
                      await refreshSessionIfNeeded();
                      await loadStats();
                    }}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 8 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : loading ? (
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
            onPress={() => router.push('/profile/change-password' as any)}
            activeOpacity={0.7}
          >
            <Lock size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Change password</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push(pathname ? `/profile/notifications?from=${encodeURIComponent(pathname)}` : '/profile/notifications' as any)}
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
            onPress={() => router.push('/(tabs)/profile/groups/index' as any)}
            activeOpacity={0.7}
          >
            <MessageCircle size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Groups</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/profile/delete-account' as any)}
            activeOpacity={0.7}
          >
            <Trash2 size={22} color={colors.danger} />
            <Text style={[styles.menuText, { color: colors.danger }]}>Delete account</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          {(isEventAdmin || user?.is_platform_admin) && (
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => router.push('/(tabs)/profile/groups/new')}
              activeOpacity={0.7}
            >
              <MessageCircle size={22} color={colors.primary} />
              <Text style={[styles.menuText, { color: colors.primary, fontWeight: '600' }]}>Create group</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {(isEventAdmin || user?.is_platform_admin) && (
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => router.push('/profile/admin')}
              activeOpacity={0.7}
            >
              <Shield size={22} color={isEventAdmin && currentEvent ? colors.primary : colors.textSecondary} />
              <Text style={styles.menuText}>Event admin</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <LogOut size={22} color={colors.danger} />
              <Text style={styles.logoutText}>Logout</Text>
            </>
          )}
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
    flexGrow: 1,
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
