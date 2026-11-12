import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useFocusEffect } from "@react-navigation/native";
import { Bell } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase } from '../lib/supabase';
import { subscribeUserNotifications } from '../lib/notificationsRealtime';
import { registerRefetchOnSessionRefreshed } from '../lib/onSessionRefreshed';
import { setAppBadgeCount } from '../lib/pushNotifications';
import { colors } from '../constants/colors';
import { useEventThemeColor } from '../lib/eventTheme';


const POLL_MS = 60_000;
const UNREAD_CACHE_MS = 15_000;

interface UnreadCache {
  key: string;
  count: number;
  updatedAt: number;
}

let unreadCache: UnreadCache | null = null;
let unreadInFlight: { key: string; promise: Promise<number | null> } | null = null;

async function loadUnreadCount(
  userId: string,
  eventId: string,
  force = false,
): Promise<number | null> {
  const key = `${userId}:${eventId}`;
  if (
    !force &&
    unreadCache?.key === key &&
    Date.now() - unreadCache.updatedAt < UNREAD_CACHE_MS
  ) {
    return unreadCache.count;
  }
  if (unreadInFlight?.key === key) return unreadInFlight.promise;

  const promise = (async () => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .eq('is_read', false)
      // Chat messages live in Chat hub — don't inflate the bell badge.
      .neq('type', 'message');
    if (error) return null;
    const nextCount = count ?? 0;
    unreadCache = { key, count: nextCount, updatedAt: Date.now() };
    return nextCount;
  })();
  unreadInFlight = { key, promise };
  void promise.finally(() => {
    if (unreadInFlight?.promise === promise) unreadInFlight = null;
  });
  return promise;
}

type HeaderNotificationBellProps = {
  /** Use on Feed page to keep badge inside bounds and avoid header clipping */
  compact?: boolean;
  /** Merged after base styles (e.g. `{ marginRight: 0 }` when paired with profile in a tight cluster). */
  style?: StyleProp<ViewStyle>;
};

export default function HeaderNotificationBell({ compact, style }: HeaderNotificationBellProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthStore();
  const currentEvent = useEventStore((s) => s.currentEvent);
  const themeColor = useEventThemeColor();
  const [unreadCount, setUnreadCount] = useState(0);
  const appStateRef = useRef(AppState.currentState);

  const fetchUnreadCount = useCallback(async (force = false) => {
    if (!user?.id) return;
    if (!currentEvent?.id) {
      setUnreadCount(0);
      setAppBadgeCount(0);
      return;
    }
    const count = await loadUnreadCount(user.id, currentEvent.id, force);
    if (count === null) return;
    setUnreadCount(count);
    setAppBadgeCount(count);
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchUnreadCount();
    }, [user?.id, fetchUnreadCount])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return registerRefetchOnSessionRefreshed(() => {
      if (user?.id) fetchUnreadCount();
    });
  }, [user?.id, fetchUnreadCount]);

  useEffect(() => {
    const id = setInterval(() => {
      if (appStateRef.current === 'active' && user?.id) fetchUnreadCount();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [user?.id, fetchUnreadCount]);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeUserNotifications(user.id, {
      onInsert: () => { void fetchUnreadCount(true); },
      onUpdate: () => { void fetchUnreadCount(true); },
    });
  }, [user?.id, fetchUnreadCount]);

  if (!user) return null;

  return (
    <TouchableOpacity
      onPress={() =>
        router.push(
          `/profile/notifications${pathname ? `?from=${encodeURIComponent(pathname)}` : ''}` as any
        )
      }
      style={[styles.bellBtn, style]}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.85}
    >
      <Bell
        size={22}
        color={unreadCount > 0 ? (colors.danger ?? '#ef4444') : themeColor}
        strokeWidth={1.75}
      />
      {unreadCount > 0 && (
        <View style={[styles.badge, compact && styles.badgeCompact]}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    marginRight: 8,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger ?? '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeCompact: {
    top: undefined,
    right: 0,
    bottom: 0,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
