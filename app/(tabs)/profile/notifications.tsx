import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
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
  Switch,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, X } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { registerRefetchOnSessionRefreshed } from '../../../lib/onSessionRefreshed';
import { addDebugLog } from '../../../lib/debugLog';
import { setAppBadgeCount } from '../../../lib/pushNotifications';
import { ensureCurrentEventForId } from '../../../lib/ensureEventForNotification';
import { colors, notificationIcons } from '../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../lib/eventTheme';
import { chatHref, groupChatHref } from '../../../lib/navReturn';
import type { User } from '../../../lib/types';
import { loadCachedSnapshot, saveCachedSnapshot, snapshotKeys } from '../../../lib/eventOfflineCache';
import {
  fetchEventNotificationRows,
  isNotificationRows,
  type NotificationRow,
} from '../../../lib/notificationRows';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { format } from 'date-fns';

const NOTIFICATIONS_PATH = '/profile/notifications';
const FROM_NOTIFICATIONS = `?from=${encodeURIComponent(NOTIFICATIONS_PATH)}`;

function dataPick(data: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (v) return v;
  }
  return undefined;
}


function NotificationsTopBar({
  onBack,
  onReadAll,
  unreadCount,
  themeColor,
}: {
  onBack: () => void;
  onReadAll: () => void;
  unreadCount: number;
  themeColor: string;
}) {
  const readAllDisabled = unreadCount === 0;
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.topBarBackHit}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.85}
        >
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
      </View>
      <Text style={styles.topBarTitle} numberOfLines={1}>
        Notifications
      </Text>
      <View style={[styles.topBarSide, styles.topBarSideRight]}>
        <TouchableOpacity
          onPress={onReadAll}
          style={styles.topBarReadAll}
          hitSlop={8}
          disabled={readAllDisabled}
          activeOpacity={0.85}
        >
          <Check
            size={20}
            color={!readAllDisabled ? themeColor : colors.textMuted}
            strokeWidth={2}
          />
          <Text
            style={[
              styles.topBarReadAllText,
              { color: themeColor },
              readAllDisabled && styles.readAllTextDisabled,
            ]}
          >
            Read all
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user, updateProfile, refreshUser } = useAuthStore();
  const currentEvent = useEventStore((s) => s.currentEvent);
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '22');

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

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);
  const [reminderPrefBusy, setReminderPrefBusy] = useState(false);

  const skipSameRoomReminders = user?.session_reminder_skip_same_room !== false;
  const savedOnlyReminders = user?.session_reminder_saved_only !== false;

  const saveReminderPref = async (
    updates: Pick<User, 'session_reminder_skip_same_room' | 'session_reminder_saved_only'>
  ) => {
    if (!user?.id) return;
    setReminderPrefBusy(true);
    try {
      const { error } = await updateProfile(updates);
      if (error) {
        Toast.show({ type: 'error', text1: 'Could not save', text2: error, visibilityTime: 4000 });
      } else {
        await refreshUser();
      }
    } finally {
      setReminderPrefBusy(false);
    }
  };

  const fetchInProgressRef = useRef(false);
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
      const all = await withRetryAndRefresh(() => fetchEventNotificationRows(user.id, currentEvent.id));
      if (__DEV__) console.log('[Notifications] Supabase query returned data (count):', all?.length ?? 0);
      setItems(all);
      setFetchError(null);
      setFetchErrorDetail(null);
      const unread = all.filter((n) => !n.is_read).length;
      setAppBadgeCount(unread);
      useConnectivityStore.getState().reportSuccess();
      void saveCachedSnapshot(snapshotKeys.notifications(currentEvent.id, user.id), all);
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      addDebugLog('Notifications', 'Load failed', msg);
      if (__DEV__) console.log('[Notifications] Supabase call failed — exact error object:', err);
      useConnectivityStore.getState().reportFailure(err);
      const cached = await loadCachedSnapshot(
        snapshotKeys.notifications(currentEvent.id, user.id),
        isNotificationRows,
      );
      if (cached && cached.length > 0) {
        setItems(cached);
        setFetchError(null);
        setFetchErrorDetail(null);
        useConnectivityStore.getState().setShowingCachedData(true);
      } else {
        setItems([]);
        setFetchError('Error - page not loading');
        setFetchErrorDetail(msg);
      }
    } finally {
      fetchInProgressRef.current = false;
      setLoading(false);
    }
  }, [user?.id, currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchNotifications().catch(() => {});
      }
    }, [user?.id, fetchNotifications])
  );

  useEffect(() => {
    const unregister = registerRefetchOnSessionRefreshed(() => {
      if (user?.id) fetchNotifications().catch(() => {});
    });
    return unregister;
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
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
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

  const handleNotificationPress = async (item: NotificationRow) => {
    markAsRead(item.id);
    const data = item.data ?? {};

    // Direct message (not group invite — those use group_id below)
    if (item.type === 'message' && dataPick(data, 'chat_user_id', 'chatUserId')) {
      const uid = dataPick(data, 'chat_user_id', 'chatUserId')!;
      router.push(chatHref(uid, NOTIFICATIONS_PATH) as never);
      return;
    }
    if (dataPick(data, 'group_id', 'groupId')) {
      const gid = dataPick(data, 'group_id', 'groupId')!;
      router.push(groupChatHref(gid, NOTIFICATIONS_PATH) as never);
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
      router.push(chatHref(uid, NOTIFICATIONS_PATH) as never);
      return;
    }
    if (item.type === 'meeting' && dataPick(data, 'booth_id', 'boothId')) {
      const boothId = dataPick(data, 'booth_id', 'boothId')!;
      if (item.event_id) {
        await ensureCurrentEventForId(item.event_id, user?.is_platform_admin === true);
      }
      const slotId = dataPick(data, 'slot_id', 'slotId');
      const fromEnc = encodeURIComponent(NOTIFICATIONS_PATH);
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
    <View
      style={[
        styles.row,
        !item.is_read && { backgroundColor: themeFaded, borderColor: themeColor },
      ]}
    >      <TouchableOpacity
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <NotificationsTopBar onBack={goBack} onReadAll={markAllAsRead} unreadCount={0} themeColor={themeColor} />
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <NotificationsTopBar onBack={goBack} onReadAll={markAllAsRead} unreadCount={0} themeColor={themeColor} />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.placeholderText}>Loading notifications…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <NotificationsTopBar onBack={goBack} onReadAll={markAllAsRead} unreadCount={unreadCount} themeColor={themeColor} />
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
            style={[styles.retryBtn, { backgroundColor: themeColor }]}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <NotificationsTopBar onBack={goBack} onReadAll={markAllAsRead} unreadCount={unreadCount} themeColor={themeColor} />
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <View style={styles.prefCard}>
              <Text style={styles.prefTitle}>Agenda reminders</Text>
              <View style={[styles.prefRow, styles.prefRowSpaced]}>
                <View style={styles.prefTextCol}>
                  <Text style={styles.prefLabel}>Only sessions I saved</Text>
                  <Text style={styles.prefHint}>
                    When on, you only get a starting-soon alert for sessions you saved in the Agenda. Turn off to get one
                    for every session.
                  </Text>
                </View>
                <Switch
                  value={savedOnlyReminders}
                  onValueChange={(v) => void saveReminderPref({ session_reminder_saved_only: v })}
                  disabled={reminderPrefBusy}
                  trackColor={{ false: colors.border, true: themeFaded }}
                  thumbColor={savedOnlyReminders ? themeColor : colors.textMuted}
                />
              </View>
              <View style={styles.prefRow}>
                <View style={styles.prefTextCol}>
                  <Text style={styles.prefLabel}>Skip same-room alerts</Text>
                  <Text style={styles.prefHint}>
                    When on, you will not get a starting-soon push if your previous bookmarked session that day was in the
                    same room. Turn off to always get reminders.
                  </Text>
                </View>
                <Switch
                  value={skipSameRoomReminders}
                  onValueChange={(v) => void saveReminderPref({ session_reminder_skip_same_room: v })}
                  disabled={reminderPrefBusy}
                  trackColor={{ false: colors.border, true: themeFaded }}
                  thumbColor={skipSameRoomReminders ? themeColor : colors.textMuted}
                />
              </View>
            </View>
            <Text style={styles.chatHint}>Chats are under Chat in the menu — not listed here.</Text>
          </View>
        }
        contentContainerStyle={[styles.list, (items.length === 0 || items.length < 5) && styles.listGrow, { minHeight: Dimensions.get('window').height + 2 }]}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No notifications yet.</Text>
            <Text style={styles.emptyChatHint}>New messages show under Chat in the hamburger menu.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColor]} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingHorizontal: 4,
    minHeight: 48,
  },
  topBarSide: {
    width: 108,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBarSideRight: {
    justifyContent: 'flex-end',
  },
  topBarBackHit: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  topBarTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  topBarReadAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  topBarReadAllText: { fontSize: 14, fontWeight: '500' },
  readAllTextDisabled: { color: colors.textMuted },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  prefCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  prefTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prefRowSpaced: {
    marginBottom: 16,
  },
  prefTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  prefLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  prefHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },
  chatHint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  emptyChatHint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
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
