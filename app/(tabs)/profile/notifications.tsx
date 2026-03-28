import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Dimensions,
  AppState,
  AppStateStatus,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { ChevronLeft, Check, X } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { addDebugLog } from '../../../lib/debugLog';
import { setAppBadgeCount } from '../../../lib/pushNotifications';
import { colors, notificationIcons } from '../../../constants/colors';
import { format } from 'date-fns';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  event_id: string | null;
  /** Parsed JSON from DB; keys are normalized to strings */
  data?: Record<string, string>;
};

const NOTIFICATIONS_PATH = '/profile/notifications';
const FROM_NOTIFICATIONS = `?from=${encodeURIComponent(NOTIFICATIONS_PATH)}`;

/** Supabase may return jsonb as object or (rarely) a JSON string */
function parseNotificationData(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return out;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, string>;
  }
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') out[k] = String(v);
  }
  return out;
}

function dataPick(data: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (v) return v;
  }
  return undefined;
}

const RESUME_REFETCH_DEBOUNCE_MS = 12000;

export default function NotificationsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();
  const currentEvent = useEventStore((s) => s.currentEvent);
  const lastResumeRefetchAt = useRef<number>(0);

  useEffect(() => {
    if (__DEV__) console.log('[Notifications] component did mount');
    return () => {
      if (__DEV__) console.log('[Notifications] component will unmount');
    };
  }, []);

  useEffect(() => {
    if (!user?.id && __DEV__) console.log('[Notifications] user session is null or expired — user?.id:', user?.id);
  }, [user?.id]);

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);

  useEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <TouchableOpacity
          onPress={goBack}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [goBack, navigation]);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);

  const fetchInProgressRef = useRef(false);
  const autoRetryScheduledRef = useRef(false);
  const mountedRef = useRef(false);
  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      if (__DEV__) console.log('[Notifications] fetch skipped — no user (session null or expired)');
      setItems([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (!currentEvent?.id) {
      setItems([]);
      setLoading(false);
      setFetchError(null);
      setAppBadgeCount(0);
      return;
    }
    if (fetchInProgressRef.current) {
      if (__DEV__) console.log('[Notifications] fetch skipped — already in progress');
      return;
    }
    if (__DEV__) console.log('[Notifications] fetch starting');
    fetchInProgressRef.current = true;
    setFetchError(null);
    setFetchErrorDetail(null);
    addDebugLog('Notifications', 'Load started');
    try {
      const all = await withRetryAndRefresh(async () => {
        const notifRes = await supabase
          .from('notifications')
          .select('id, type, title, body, is_read, created_at, event_id, data')
          .eq('user_id', user.id)
          .eq('event_id', currentEvent.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (__DEV__) console.log('[Notifications] Supabase notifications query — data:', notifRes.data, 'error:', notifRes.error);
        if (notifRes.error) throw notifRes.error;
        return (notifRes.data ?? []).map((row: NotificationRow & { data?: unknown }) => ({
          ...row,
          data: parseNotificationData(row.data),
        }));
      });
      if (__DEV__) console.log('[Notifications] Supabase query returned data (count):', all?.length ?? 0);
      setItems(all);
      autoRetryScheduledRef.current = false;
      setFetchError(null);
      setFetchErrorDetail(null);
      const unread = all.filter((n) => !n.is_read).length;
      setAppBadgeCount(unread);
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      addDebugLog('Notifications', 'Load failed', msg);
      if (__DEV__) console.log('[Notifications] Supabase call failed — exact error object:', err);
      setItems([]);
      setFetchError('Error - page not loading');
      setFetchErrorDetail(msg);
    } finally {
      fetchInProgressRef.current = false;
      setLoading(false);
    }
  }, [user?.id, currentEvent?.id]);

  // Up to 3 attempts (immediate, +2s, +5s) so transient failures often recover. Only on first mount.
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (mountedRef.current) return;
    mountedRef.current = true;
    let cancelled = false;
    const retry = (attemptIndex: number) => {
      if (cancelled) return;
      fetchNotifications().catch(() => {
        if (cancelled) return;
        if (attemptIndex === 0) setTimeout(() => retry(1), 2000);
        else if (attemptIndex === 1) setTimeout(() => retry(2), 5000);
      });
    };
    retry(0);
    return () => { cancelled = true; };
  }, [fetchNotifications]);

  // Switching the active event should reload the list (event-scoped notifications only).
  useEffect(() => {
    if (!user?.id || !currentEvent?.id) return;
    fetchInProgressRef.current = false;
    fetchNotifications().catch(() => {});
  }, [currentEvent?.id, user?.id, fetchNotifications]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchInProgressRef.current = false;
        fetchNotifications().catch(() => {});
      }
    }, [user?.id, fetchNotifications])
  );

  // When app comes back from background: wait for root’s refresh, then load.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || !user?.id) return;
      const now = Date.now();
      if (now - lastResumeRefetchAt.current < RESUME_REFETCH_DEBOUNCE_MS) return;
      lastResumeRefetchAt.current = now;
      fetchInProgressRef.current = false;
      refreshSessionIfNeeded()
        .catch(() => {})
        .finally(() => fetchNotifications().catch(() => {}));
    });
    return () => sub.remove();
  }, [user?.id, fetchNotifications]);

  const screenLoadTimeoutMs = 30000;
  const loadingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    loadingStartRef.current = Date.now();
    const t = setTimeout(() => {
      if (loadingStartRef.current !== null && Date.now() - loadingStartRef.current >= screenLoadTimeoutMs) {
        addDebugLog('Notifications', 'Load timed out', 'Request never completed — check network or Supabase');
        fetchInProgressRef.current = false;
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
        if (!autoRetryScheduledRef.current && user?.id) {
          autoRetryScheduledRef.current = true;
          setTimeout(() => fetchNotifications().catch(() => {}), 2000);
        }
      }
    }, screenLoadTimeoutMs);
    return () => clearTimeout(t);
  }, [loading, user?.id, fetchNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    addDebugLog('Notifications', 'Pull-to-refresh started');
    if (__DEV__) Toast.show({ type: 'info', text1: 'Refreshing...', visibilityTime: 1500 });
    try {
      await refreshSessionIfNeeded();
      await fetchNotifications();
      addDebugLog('Notifications', 'Pull-to-refresh finished');
      if (__DEV__) Toast.show({ type: 'success', text1: 'Refresh done', visibilityTime: 2000 });
    } catch (e) {
      const msg = getErrorMessage(e);
      addDebugLog('Notifications', 'Pull-to-refresh failed', msg);
      if (__DEV__) console.log('[Notifications] onRefresh failed — exact error object:', e);
      if (__DEV__) Toast.show({ type: 'error', text1: 'Refresh failed', text2: msg.slice(0, 50), visibilityTime: 4000 });
      setFetchError('Error - page not loading');
    } finally {
      setRefreshing(false);
    }
  };

  const markAsRead = async (id: string) => {
    if (!user?.id) return;
    try {
      const res = await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id).select();
      if (__DEV__) console.log('[Notifications] Supabase markAsRead — data:', res.data, 'error:', res.error);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      const newUnread = Math.max(0, unreadCount - 1);
      setAppBadgeCount(newUnread);
    } catch (err) {
      if (__DEV__) console.log('[Notifications] markAsRead failed — exact error object:', err);
    }
  };

  const markAllAsRead = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) return;
    try {
      const res = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .eq('event_id', currentEvent.id)
        .select();
      if (__DEV__) console.log('[Notifications] Supabase markAllAsRead — data:', res.data, 'error:', res.error);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setAppBadgeCount(0);
    } catch (err) {
      if (__DEV__) console.log('[Notifications] markAllAsRead failed — exact error object:', err);
    }
  }, [user?.id, currentEvent?.id]);

  const deleteNotification = async (id: string) => {
    if (!user?.id) return;
    try {
      const res = await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id).select();
      if (__DEV__) console.log('[Notifications] Supabase deleteNotification — data:', res.data, 'error:', res.error);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      if (__DEV__) console.log('[Notifications] deleteNotification failed — exact error object:', err);
    }
  };

  const unreadCount = items.filter((n) => !n.is_read).length;

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={markAllAsRead}
            style={styles.headerBtn}
            hitSlop={8}
            disabled={unreadCount === 0}
          >
            <Check size={20} color={unreadCount > 0 ? colors.primary : colors.textMuted} strokeWidth={2} />
            <Text style={[styles.headerBtnText, unreadCount === 0 && styles.headerBtnTextDisabled]}>
              Read all
            </Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, unreadCount, markAllAsRead]);

  const handleNotificationPress = (item: NotificationRow) => {
    markAsRead(item.id);
    const data = item.data ?? {};

    // Direct message (not group invite — those use group_id below)
    if (item.type === 'message' && dataPick(data, 'chat_user_id', 'chatUserId')) {
      const uid = dataPick(data, 'chat_user_id', 'chatUserId')!;
      router.push(`/profile/chat/${uid}${FROM_NOTIFICATIONS}` as any);
      return;
    }
    if (dataPick(data, 'group_id', 'groupId')) {
      const gid = dataPick(data, 'group_id', 'groupId')!;
      router.push(`/profile/groups/${gid}${FROM_NOTIFICATIONS}` as any);
      return;
    }
    if ((item.type === 'like' || item.type === 'comment') && dataPick(data, 'post_id', 'postId')) {
      const pid = dataPick(data, 'post_id', 'postId')!;
      const q = item.event_id ? `?eventId=${encodeURIComponent(item.event_id)}` : '';
      router.replace(`/(tabs)/feed/comment/${pid}${q}` as any);
      return;
    }
    if (item.type === 'schedule_change') {
      const sid = dataPick(data, 'session_id', 'sessionId');
      if (sid) {
        router.push(`/(tabs)/schedule?sessionId=${encodeURIComponent(sid)}` as any);
      } else {
        router.push('/(tabs)/schedule' as any);
      }
      return;
    }
    if (item.type === 'connection_request' && dataPick(data, 'requester_id', 'requesterId')) {
      const rid = dataPick(data, 'requester_id', 'requesterId')!;
      router.push(`/(tabs)/feed/user/${rid}${FROM_NOTIFICATIONS}` as any);
      return;
    }
    if (item.type === 'system' && dataPick(data, 'chat_user_id', 'chatUserId')) {
      const uid = dataPick(data, 'chat_user_id', 'chatUserId')!;
      router.push(`/profile/chat/${uid}${FROM_NOTIFICATIONS}` as any);
      return;
    }
    if (item.type === 'meeting' && dataPick(data, 'booth_id', 'boothId')) {
      const boothId = dataPick(data, 'booth_id', 'boothId')!;
      const slotId = dataPick(data, 'slot_id', 'slotId');
      const fromEnc = encodeURIComponent('/(tabs)/schedule');
      const rateParam = slotId ? `&rate_slot_id=${encodeURIComponent(slotId)}` : '';
      router.push(`/(tabs)/expo/${boothId}?from=${fromEnc}${rateParam}` as any);
      return;
    }
    if (item.type === 'announcement') {
      router.push(`/profile/announcements${FROM_NOTIFICATIONS}` as any);
      return;
    }
    if (item.type === 'points') {
      router.push('/(tabs)/leaderboard' as any);
      return;
    }
    if (item.type === 'badge') {
      router.push('/(tabs)/profile' as any);
      return;
    }
    if (item.type === 'message' && !dataPick(data, 'chat_user_id', 'chatUserId')) {
      Toast.show({
        type: 'info',
        text1: 'No link',
        text2: 'Open Messages from your profile to continue the conversation.',
        visibilityTime: 3500,
      });
      return;
    }
    Toast.show({
      type: 'info',
      text1: 'Notification',
      text2: 'There is no screen linked to this notification.',
      visibilityTime: 3000,
    });
  };

  const handleClearOne = (item: NotificationRow) => {
    Alert.alert('Clear notification?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => deleteNotification(item.id) },
    ]);
  };

  const renderItem = ({ item }: { item: NotificationRow }) => (
    <View style={[styles.row, !item.is_read && styles.rowUnread]}>
      <TouchableOpacity
        style={styles.rowTouchable}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.icon}>{notificationIcons[item.type] ?? 'ℹ️'}</Text>
        <View style={styles.body}>
        <Text style={[styles.title, !item.is_read && styles.titleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.body ? (
          <Text style={styles.bodyText} numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
        <Text style={styles.time}>{format(new Date(item.created_at), 'MMM d, h:mm a')}</Text>
      </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleClearOne(item)}
        style={styles.clearBtn}
        hitSlop={8}
      >
        <X size={18} color={colors.textMuted} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );

  if (!user) return null;

  if (!currentEvent?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            Join or select an event to see notifications for that event only.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.placeholderText}>Loading notifications…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Error - page not loading</Text>
          {fetchErrorDetail ? (
            <Text style={[styles.errorSubtext, { fontStyle: 'italic', marginTop: 4 }]} numberOfLines={2}>
              {fetchErrorDetail}
            </Text>
          ) : null}
          <Text style={styles.errorSubtext}>Pull down to refresh or tap Try again.</Text>
          {fetchErrorDetail?.toLowerCase().includes('timed out') ? (
            <Text style={[styles.errorSubtext, { marginTop: 8, fontStyle: 'italic', fontSize: 11 }]}>
              Check Metro console or try: npx expo start --tunnel
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={async () => {
              setFetchError(null);
              setFetchErrorDetail(null);
              setLoading(true);
              await refreshSessionIfNeeded();
              await fetchNotifications();
            }}
            style={styles.retryBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, (items.length === 0 || items.length < 5) && styles.listGrow, { minHeight: Dimensions.get('window').height + 2 }]}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No notifications yet.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backButton: { marginLeft: 8, padding: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  headerBtnText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
  headerBtnTextDisabled: { color: colors.textMuted },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  listGrow: {
    flexGrow: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    position: 'relative',
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowUnread: {
    backgroundColor: colors.primaryFaded,
    borderColor: colors.primary,
  },
  rowTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  clearBtn: {
    padding: 8,
    marginLeft: 4,
    marginTop: -4,
    marginRight: -4,
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  titleUnread: {
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  time: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
});
