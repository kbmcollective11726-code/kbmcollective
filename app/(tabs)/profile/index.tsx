import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
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
  Dimensions,
} from 'react-native';
import Constants from 'expo-constants';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { ExternalLink, LogOut, ChevronRight, Users, Edit3, Bell, Shield, MessageCircle, Trash2, Lock, BookOpen } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { registerRefetchOnSessionRefreshed } from '../../../lib/onSessionRefreshed';
import { addDebugLog } from '../../../lib/debugLog';
import { colors } from '../../../constants/colors';
import { useEventThemeColor } from '../../../lib/eventTheme';
import Avatar from '../../../components/Avatar';
import PortraitAvatarPhoto from '../../../components/PortraitAvatarPhoto';
import ProfileHeroBackdrop from '../../../components/ProfileHeroBackdrop';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import { RolePreviewMenuButton, RolePreviewPicker } from '../../../components/RolePreviewBanner';
import { useRolePreviewContext } from '../../../hooks/useRolePreviewContext';
import { effectiveMyRoles } from '../../../lib/rolePreview';
import { fetchUnreadDmCount } from '../../../lib/unreadDmMessages';


function getAppVersionLabel(): string {
  const marketing = Constants.expoConfig?.version?.trim() ?? '';
  if (Constants.appOwnership === 'expo') {
    return marketing ? `Version ${marketing} · Expo Go` : 'Expo Go';
  }
  if (marketing) return `Version ${marketing}`;
  return '';
}

export default function ProfileScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = useIsFocused();
  const { user, refreshUser, logout } = useAuthStore();
  const { currentEvent } = useEventStore();
  const themeColor = useEventThemeColor();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [myRoles, setMyRoles] = useState<string[]>(['attendee']);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [rolePreviewOpen, setRolePreviewOpen] = useState(false);
  const { applyEventAdmin, isPlatformAdmin, isPreviewing, previewRole } = useRolePreviewContext();

  const fetchPointsAndRole = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (currentEvent?.id) {
      // Fetch membership once (points and roles share the same row) and run the
      // independent post count concurrently. This avoids serial requests and
      // duplicate work on slower Expo Go Android connections.
      const [memberResult, postsResult] = await Promise.allSettled([
        supabase
          .from('event_members')
          .select('points, role, roles')
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id)
          .eq('is_deleted', false),
      ]);

      let pointsOk = false;
      let roleOk = false;
      let postsOk = false;
      if (memberResult.status === 'fulfilled' && !memberResult.value.error) {
        const data = memberResult.value.data as {
          points?: number;
          role?: string;
          roles?: string[];
        } | null;
        setPoints(data?.points ?? 0);
        const role = data?.role ?? 'attendee';
        const roles =
          Array.isArray(data?.roles) && data.roles.length > 0
            ? data.roles
            : [role];
        setIsEventAdmin(
          role === 'admin' ||
            role === 'super_admin' ||
            roles.includes('admin') ||
            roles.includes('super_admin') ||
            user.is_platform_admin === true
        );
        setMyRoles(roles);
        pointsOk = true;
        roleOk = true;
      }
      if (postsResult.status === 'fulfilled' && !postsResult.value.error) {
        setPostsCount(postsResult.value.count ?? 0);
        postsOk = true;
      }
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
  }, [user?.id, user?.is_platform_admin, currentEvent?.id]);

  const effectiveIsEventAdmin = applyEventAdmin(isEventAdmin);
  const displayRoles = effectiveMyRoles(myRoles, isPlatformAdmin, previewRole);

  const loadInProgressRef = useRef(false);
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


  const fetchUnreadBadges = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) {
      setUnreadNotifications(0);
      setUnreadChats(0);
      return;
    }
    const [notifRes, chatCount] = await Promise.all([
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .eq('event_id', currentEvent.id)
        .neq('type', 'message'),
      fetchUnreadDmCount(currentEvent.id, user.id).catch(() => 0),
    ]);
    if (!notifRes.error) setUnreadNotifications(notifRes.count ?? 0);
    setUnreadChats(chatCount);
  }, [user?.id, currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        loadStats().catch(() => {});
        void fetchUnreadBadges();
      }
    }, [user?.id, loadStats, fetchUnreadBadges])
  );

  useEffect(() => {
    const unregister = registerRefetchOnSessionRefreshed(() => {
      if (user?.id) loadStats().catch(() => {});
    });
    return unregister;
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
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
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
    { key: 'attendee', label: 'Attendee' },
    { key: 'speaker', label: 'Speaker' },
    { key: 'vendor', label: 'Vendor' },
  ] as const;

  const roleLabel = (r: string) =>
    ROLE_OPTIONS.find((o) => o.key === r)?.label ?? (r === 'admin' || r === 'super_admin' ? 'Admin' : r);

  if (!user) return null;

  const versionLabel = getAppVersionLabel();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="hamburger" title="Profile" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { minHeight: Dimensions.get('window').height + 2 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[themeColor]}
          />
        }
      >
        <View style={styles.hero}>
          {user.avatar_url ? (
            <View style={styles.heroBackdrop} pointerEvents="none">
              <ProfileHeroBackdrop avatarUrl={user.avatar_url} />
            </View>
          ) : null}
          <View style={styles.heroForeground}>
            <View style={styles.heroAvatarShadow}>
              <TouchableOpacity
                onPress={() => router.push(`/profile/edit?from=${encodeURIComponent('/(tabs)/profile')}` as never)}
                style={styles.heroAvatarWrap}
                activeOpacity={0.85}
              >
                {user.avatar_url ? (
                  <PortraitAvatarPhoto uri={user.avatar_url} transition={150} />
                ) : (
                  <Avatar uri={null} name={user.full_name} size={112} />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.heroName}>{user.full_name}</Text>
          </View>
        </View>

        <View style={styles.body}>
        <Text style={styles.email}>{user.email}</Text>
        {(user.title || user.company) ? (
          <Text style={styles.subtitle}>
            {[user.title, user.company].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

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
            <ExternalLink size={18} color={themeColor} />
            <Text style={[styles.linkedinText, { color: themeColor }]}>View LinkedIn profile</Text>
          </TouchableOpacity>
        ) : null}

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
                    style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: themeColor, borderRadius: 8 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : loading ? (
                <ActivityIndicator size="small" color={themeColor} />
              ) : (
                <>
                  {points !== null && (
                    <View style={styles.stat}>
                      <Text style={[styles.statValue, { color: themeColor }]}>{points}</Text>
                      <Text style={styles.statLabel}>points</Text>
                    </View>
                  )}
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: themeColor }]}>{postsCount}</Text>
                    <Text style={styles.statLabel}>posts</Text>
                  </View>
                </>
              )}
            </View>

            <View style={styles.roleCard}>
              <Text style={styles.roleLabel}>My roles for this event</Text>
              <View style={styles.roleRow}>
                <Text style={styles.roleValue} numberOfLines={2}>
                  {displayRoles.length ? displayRoles.map(roleLabel).join(', ') : 'None'}
                  {isPreviewing ? ' (preview)' : ''}
                </Text>
              </View>
              <Text style={styles.roleHint}>
                {isPreviewing
                  ? 'Role preview is on — use Preview as role below or the hamburger menu to switch back.'
                  : 'Only event or platform admins can change roles. They can do that in Event admin → Manage members.'}
              </Text>
            </View>
          </>
        )}

        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push(`/profile/edit?from=${encodeURIComponent('/(tabs)/profile')}` as never)}
            activeOpacity={0.7}
          >
            <Edit3 size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Edit profile</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() =>
              router.push(`/(tabs)/profile/change-password?from=${encodeURIComponent('/(tabs)/profile')}` as never)
            }
            activeOpacity={0.7}
          >
            <Lock size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Change password</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/profile/user-guide' as any)}
            activeOpacity={0.7}
          >
            <BookOpen size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>How to use</Text>
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
              <View style={[styles.notifBadge, { backgroundColor: themeColor }]}>
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
            onPress={() =>
              router.push(
                `/(tabs)/profile/messages?from=${encodeURIComponent('/(tabs)/profile')}` as never
              )
            }
            activeOpacity={0.7}
          >
            <MessageCircle size={22} color={colors.textSecondary} />
            <Text style={styles.menuText}>Chat</Text>
            {unreadChats > 0 && (
              <View style={[styles.notifBadge, { backgroundColor: themeColor }]}>
                <Text style={styles.notifBadgeText}>{unreadChats > 99 ? '99+' : unreadChats}</Text>
              </View>
            )}
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
          {effectiveIsEventAdmin && (
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const messagesFrom = `/(tabs)/profile/messages?from=${encodeURIComponent('/(tabs)/profile')}`;
                router.push(
                  `/(tabs)/profile/groups/new?from=${encodeURIComponent(messagesFrom)}` as never
                );
              }}
              activeOpacity={0.7}
            >
              <MessageCircle size={22} color={themeColor} />
              <Text style={[styles.menuText, { color: themeColor, fontWeight: '600' }]}>Create group</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {effectiveIsEventAdmin && (
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => router.push('/profile/admin')}
              activeOpacity={0.7}
            >
              <Shield size={22} color={effectiveIsEventAdmin && currentEvent ? themeColor : colors.textSecondary} />
              <Text style={styles.menuText}>Event admin</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {isPlatformAdmin ? (
            <View style={styles.previewMenuWrap}>
              <RolePreviewMenuButton onPress={() => setRolePreviewOpen(true)} />
            </View>
          ) : null}
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

        {versionLabel ? (
          <Text style={styles.versionFootnote} accessibilityLabel={`App version ${versionLabel}`}>
            {versionLabel}
          </Text>
        ) : null}
        </View>
      </ScrollView>
      <RolePreviewPicker visible={rolePreviewOpen} onClose={() => setRolePreviewOpen(false)} />
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
    paddingBottom: 48,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  hero: {
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 268,
    backgroundColor: colors.surfaceHover ?? '#eef1f5',
    paddingTop: 20,
    paddingBottom: 28,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  heroBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  heroForeground: {
    alignItems: 'center',
    width: '100%',
    paddingBottom: 4,
    paddingHorizontal: 20,
  },
  heroAvatarShadow: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  heroAvatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: colors.background,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  heroName: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginTop: 18,
    marginBottom: 2,
    paddingHorizontal: 12,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  email: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
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
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  versionFootnote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 24,
  },
  previewMenuWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
  roleOptionActive: {},
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
  roleModalSave: {},
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
