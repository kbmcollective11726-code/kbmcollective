import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  GestureResponderEvent,
  PanResponder,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Megaphone, Calendar, X } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { colors } from '../constants/colors';

type BannerNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
};

const BANNER_TYPES = ['announcement', 'schedule_change'];

export default function AnnouncementBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [notification, setNotification] = useState<BannerNotification | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;

  const dismiss = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setNotification(null));
  }, [slideAnim]);

  const show = useCallback((n: BannerNotification) => {
    setNotification(n);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [slideAnim]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('announcement-banner')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { id: string; type: string; title: string; body: string | null };
          if (BANNER_TYPES.includes(row?.type)) {
            show({
              id: row.id,
              type: row.type,
              title: row.title ?? 'Notification',
              body: row.body ?? null,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, show]);

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

  const Icon = notification.type === 'schedule_change' ? Calendar : Megaphone;

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
      <TouchableOpacity
        style={styles.touchable}
        onPress={handlePress}
        activeOpacity={1}
      >
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
    zIndex: 9999,
    backgroundColor: colors.primary,
    borderRadius: 12,
    shadowColor: colors.shadowColor ?? '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
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
