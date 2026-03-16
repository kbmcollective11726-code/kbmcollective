import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Bell } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { setAppBadgeCount } from '../lib/pushNotifications';
import { colors } from '../constants/colors';


const POLL_MS = 5000;

type HeaderNotificationBellProps = { /** Use on Feed page to keep badge inside bounds and avoid header clipping */ compact?: boolean };

export default function HeaderNotificationBell({ compact }: HeaderNotificationBellProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const appStateRef = useRef(AppState.currentState);

  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_read', false)
      .limit(500);
    if (error) return;
    const count = Array.isArray(data) ? data.length : 0;
    setUnreadCount(count);
    setAppBadgeCount(count);
  }, [user?.id]);

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
      if (state === 'active') fetchUnreadCount();
    });
    return () => sub.remove();
  }, [fetchUnreadCount]);

  useEffect(() => {
    const id = setInterval(() => {
      if (appStateRef.current === 'active' && user?.id) fetchUnreadCount();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [user?.id, fetchUnreadCount]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`header-notifications-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload?.new as Record<string, unknown> | null;
        const rowUserId = row?.user_id ?? (row as { userId?: string })?.userId;
        if (String(rowUserId) === String(user.id)) fetchUnreadCount();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload?.new as Record<string, unknown> | null;
        const rowUserId = row?.user_id ?? (row as { userId?: string })?.userId;
        if (String(rowUserId) === String(user.id)) fetchUnreadCount();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchUnreadCount]);

  if (!user) return null;

  return (
    <TouchableOpacity
      onPress={() =>
        router.push(
          `/profile/notifications${pathname ? `?from=${encodeURIComponent(pathname)}` : ''}` as any
        )
      }
      style={styles.bellBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Bell
        size={24}
        color={unreadCount > 0 ? (colors.danger ?? '#ef4444') : colors.primary}
        strokeWidth={2}
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
    marginRight: 12,
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
