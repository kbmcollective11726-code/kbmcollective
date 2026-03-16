import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Dimensions,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { ChevronLeft, Check, X } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, startForegroundRefresh, getErrorMessage } from '../../../lib/supabase';
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
  data?: { post_id?: string; comment_id?: string; chat_user_id?: string; group_id?: string };
};

export default function NotificationsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();

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
  const fetchNotifications = useCallback(async () => {
    // #region agent log
    fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'profile/notifications.tsx:fetchNotifications',message:'entry',data:{inFlight:fetchInProgressRef.current,hasUser:!!user?.id},timestamp:Date.now(),hypothesisId:'H1,H3,H5'})}).catch(()=>{});
    // #endregion
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (fetchInProgressRef.current) {
      // #region agent log
      fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'profile/notifications.tsx:fetchNotifications',message:'skip in-flight',data:{},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      return;
    }
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
          .order('created_at', { ascending: false })
          .limit(50);
        if (notifRes.error) throw notifRes.error;
        return (notifRes.data ?? []) as NotificationRow[];
      });
      setItems(all);
      autoRetryScheduledRef.current = false;
      setFetchError(null);
      setFetchErrorDetail(null);
      const unread = all.filter((n) => !n.is_read).length;
      setAppBadgeCount(unread);
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      // #region agent log
      fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'profile/notifications.tsx:fetchNotifications',message:'fetchNotifications catch',data:{msg:msg.slice(0,120)},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      addDebugLog('Notifications', 'Load failed', msg);
      if (__DEV__) console.warn('Notifications fetch error:', err);
      setItems([]);
      setFetchError('Error - page not loading');
      setFetchErrorDetail(msg);
    } finally {
      // #region agent log
      fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'profile/notifications.tsx:fetchNotifications',message:'fetchNotifications finally',data:{},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      fetchInProgressRef.current = false;
      setLoading(false);
    }
  }, [user?.id]);

  // Up to 3 attempts (immediate, +2s, +5s) so transient failures often recover.
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
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

  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchNotifications().catch(() => {});
    }, [user?.id, fetchNotifications])
  );

  // When app comes back from background: wait for root’s refresh, then load.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && user?.id) {
        // #region agent log
        fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'profile/notifications.tsx:AppState',message:'app became active',data:{screen:'Notifications'},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        fetchInProgressRef.current = false;
        setLoading(true);
        (async () => {
          const refreshTimeoutMs = 8000;
          try {
            await Promise.race([
              refreshSessionIfNeeded(),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), refreshTimeoutMs)),
            ]);
          } catch (_) {}
          fetchNotifications().catch(() => {}).finally(() => setLoading(false));
        })();
      }
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
      if (__DEV__) Toast.show({ type: 'error', text1: 'Refresh failed', text2: msg.slice(0, 50), visibilityTime: 4000 });
      setFetchError('Error - page not loading');
    } finally {
      setRefreshing(false);
    }
  };

  const markAsRead = async (id: string) => {
    if (!user?.id) return;
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      const newUnread = Math.max(0, unreadCount - 1);
      setAppBadgeCount(newUnread);
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const markAllAsRead = useCallback(async () => {
    if (!user?.id) return;
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setAppBadgeCount(0);
    } catch (err) {
      console.error('Mark all read error:', err);
    }
  }, [user?.id]);

  const deleteNotification = async (id: string) => {
    if (!user?.id) return;
    try {
      await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error('Delete notification error:', err);
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
    if (item.type === 'message' && data.chat_user_id) {
      router.push(`/profile/chat/${data.chat_user_id}?from=${encodeURIComponent('/profile/notifications')}` as any);
      return;
    }
    if (data.group_id) {
      router.push(`/profile/groups/${data.group_id}?from=${encodeURIComponent('/profile/notifications')}` as any);
      return;
    }
    if ((item.type === 'like' || item.type === 'comment') && data.post_id) {
      router.replace({ pathname: '/(tabs)/feed', params: { postId: data.post_id } } as any);
      return;
    }
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
              Open Debug (bottom-right) → Test connection to see if this device can reach Supabase.
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
