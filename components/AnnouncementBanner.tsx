import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  GestureResponderEvent,
  PanResponder,
  AppState,
  AppStateStatus,
  Platform,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Megaphone, Calendar, X } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase } from '../lib/supabase';
import { colors } from '../constants/colors';

type BannerNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
};

/** schedule_change = agenda edits + session reminders ("Event starting soon"); meeting = B2B; announcement = admin sends */
const BANNER_TYPES = ['announcement', 'schedule_change', 'meeting'] as const;

function rowMatchesEvent(row: { event_id?: string | null }, currentEventId: string | undefined) {
  if (!currentEventId) return true;
  if (row.event_id == null) return true;
  return row.event_id === currentEventId;
}

export default function AnnouncementBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const currentEvent = useEventStore((s) => s.currentEvent);
  const [notification, setNotification] = useState<BannerNotification | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const shownIdsRef = useRef<Set<string>>(new Set());
  const backgroundedAtRef = useRef<number>(Date.now());
  const didInitialCatchupRef = useRef(false);

  useEffect(() => {
    dismissedIdsRef.current.clear();
    shownIdsRef.current.clear();
    didInitialCatchupRef.current = false;
  }, [user?.id]);

  const tryShowFromRow = useCallback(
    (row: { id: string; type: string; title?: string | null; body?: string | null; event_id?: string | null }) => {
      if (!row?.id || !BANNER_TYPES.includes(row.type as (typeof BANNER_TYPES)[number])) return;
      if (!rowMatchesEvent(row, currentEvent?.id)) return;
      if (dismissedIdsRef.current.has(row.id) || shownIdsRef.current.has(row.id)) return;
      shownIdsRef.current.add(row.id);
      setNotification({
        id: row.id,
        type: row.type,
        title: row.title ?? 'Notification',
        body: row.body ?? null,
      });
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    },
    [currentEvent?.id, slideAnim]
  );

  const dismiss = useCallback(() => {
    const id = notification?.id;
    if (id) dismissedIdsRef.current.add(id);
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setNotification(null));
  }, [notification?.id, slideAnim]);

  const fetchRecentBannerRows = useCallback(
    async (sinceIso: string) => {
      if (!user?.id || !currentEvent?.id) return;
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, event_id, created_at')
        .eq('user_id', user.id)
        .eq('event_id', currentEvent.id)
        .in('type', [...BANNER_TYPES])
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error || !data?.length) return;
      const newest = data[0];
      tryShowFromRow(newest);
    },
    [user?.id, currentEvent?.id, tryShowFromRow]
  );

  // Realtime: show banner when a qualifying row is inserted while the app is connected.
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`announcement-banner-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            type: string;
            title?: string | null;
            body?: string | null;
            event_id?: string | null;
          };
          tryShowFromRow(row);
        }
      )
      .subscribe((status) => {
        if (__DEV__ && status === 'SUBSCRIBED') {
          console.log('[AnnouncementBanner] Realtime subscribed');
        }
        if (__DEV__ && status === 'CHANNEL_ERROR') {
          console.warn('[AnnouncementBanner] Realtime channel error — banner may rely on resume catch-up');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, tryShowFromRow]);

  // Android / background: INSERT often happens while the WebSocket is down; catch up when app opens or resumes.
  useEffect(() => {
    if (!user?.id || !currentEvent?.id) return;

    const runCatchUp = (sinceMs: number) => {
      const sinceIso = new Date(sinceMs).toISOString();
      void fetchRecentBannerRows(sinceIso);
    };

    // One-time short lookback when tabs first mount (covers late Realtime subscribe vs cron insert).
    if (!didInitialCatchupRef.current) {
      didInitialCatchupRef.current = true;
      runCatchUp(Date.now() - 90_000);
    }

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAtRef.current = Date.now();
      }
      if (next === 'active') {
        runCatchUp(backgroundedAtRef.current - 5000);
      }
    });

    return () => sub.remove();
  }, [user?.id, currentEvent?.id, fetchRecentBannerRows]);

  const handlePress = () => {
    dismiss();
    router.push(pathname ? `/profile/notifications?from=${encodeURIComponent(pathname)}` : '/profile/notifications');
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 30) dismiss();
      },
    })
  ).current;

  if (!notification) return null;

  const Icon =
    notification.type === 'schedule_change' || notification.type === 'meeting' ? Calendar : Megaphone;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 8,
          paddingTop: 12,
          paddingBottom: 12,
        },
        { transform: [{ translateY: slideAnim }] },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity style={styles.touchable} onPress={handlePress} activeOpacity={1}>
        <View style={styles.iconWrap}>
          <Icon size={24} color={colors.textOnPrimary} strokeWidth={2} />
        </View>
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            {notification.title}
          </Text>
          {notification.body ? (
            <Text style={styles.body} numberOfLines={2}>
              {notification.body}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={(e: GestureResponderEvent) => {
            e.stopPropagation();
            dismiss();
          }}
          hitSlop={12}
          style={styles.closeBtn}
        >
          <X size={20} color={colors.textOnPrimary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 99999,
    backgroundColor: colors.primary,
    borderRadius: 12,
    shadowColor: colors.shadowColor ?? '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    // Tab bar / headers use elevation on Android; keep banner clearly above.
    ...Platform.select({
      android: { elevation: 28 },
      default: {},
    }),
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  body: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
});
