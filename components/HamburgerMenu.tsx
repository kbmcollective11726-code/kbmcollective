import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
  ScrollView,
  useWindowDimensions,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import {
  Menu,
  X,
  Users,
  ImageIcon,
  LayoutGrid,
  Tv,
  User,
  Edit3,
  Bell,
  Shield,
  LogOut,
  ChevronRight,
  Home,
  Calendar,
  Trophy,
  Store,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../lib/supabase';
import { setAppBadgeCount } from '../lib/pushNotifications';
import { colors } from '../constants/colors';

// Set EXPO_PUBLIC_LIVE_WALL_URL in .env (e.g. http://localhost:3000) or it defaults to localhost
const LIVE_WALL_BASE_URL = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LIVE_WALL_URL) || 'http://localhost:3000';

type HamburgerMenuProps = {
  onLogout?: () => void;
};

export default function HamburgerMenu({ onLogout }: HamburgerMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { currentEvent, adminCheckTick } = useEventStore();
  const isPlatformAdmin = user?.is_platform_admin === true;

  const fetchUnreadCount = useCallback(() => {
    if (!user?.id) return;
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (currentEvent?.id) {
      query = query.eq('event_id', currentEvent.id);
    }
    query.then(({ count }) => {
      const n = count ?? 0;
      setUnreadNotifications(n);
      setAppBadgeCount(n);
    });
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (visible) fetchUnreadCount();
  }, [visible, fetchUnreadCount]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('notifications-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchUnreadCount)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchUnreadCount)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchUnreadCount]);

  const tryAnyEventAdmin = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    try {
      const data = await withRetryAndRefresh(async () => {
        const { data: d, error } = await supabase
          .from('event_members')
          .select('event_id')
          .eq('user_id', user.id)
          .in('role', ['admin', 'super_admin'])
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return d;
      });
      setIsEventAdmin(data != null);
    } catch {
      // keep previous state on error so Event admin menu doesn't disappear
    }
  }, [user?.id]);

  const fetchEventAdminStatus = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    if (currentEvent?.id) {
      try {
        const data = await withRetryAndRefresh(async () => {
          const { data: d, error } = await supabase
            .from('event_members')
            .select('role, roles')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .single();
          if (error) throw error;
          return d;
        });
        const row = data as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        setIsEventAdmin(role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
      } catch {
        await tryAnyEventAdmin();
      }
      return;
    }
    await tryAnyEventAdmin();
  }, [user?.id, currentEvent?.id, tryAnyEventAdmin]);

  useEffect(() => {
    fetchEventAdminStatus();
  }, [fetchEventAdminStatus, adminCheckTick]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && user?.id) fetchEventAdminStatus();
    });
    return () => sub.remove();
  }, [user?.id, fetchEventAdminStatus]);

  // Refetch when menu opens so she always sees latest role (e.g. just made admin, or event selected after load)
  useEffect(() => {
    if (visible && user?.id) fetchEventAdminStatus();
  }, [visible, user?.id, fetchEventAdminStatus]);

  const close = () => setVisible(false);

  const navigate = (path: string) => {
    close();
    router.push(path as any);
  };

  // For profile sub-pages, pass current path so back button returns to the page user was on
  const returnTo = pathname && pathname !== '/' ? pathname : '/(tabs)/home';
  const navigateToProfileScreen = (screen: string) => {
    close();
    router.push(`${screen}?from=${encodeURIComponent(returnTo)}` as any);
  };

  const handleLogout = async () => {
    close();
    try {
      await logout();
      onLogout?.();
      router.replace('/(auth)/login');
    } catch {
      router.replace('/(auth)/login');
    }
  };

  const openLiveWall = () => {
    close();
    const url = currentEvent?.id
      ? `${LIVE_WALL_BASE_URL}/wall?event=${currentEvent.id}`
      : LIVE_WALL_BASE_URL;
    Linking.openURL(url).catch(() => {});
  };

  const menuWidth = Math.min(width * 0.8, 320);

  const openMenu = () => {
    setVisible(true);
    // Refetch admin status as soon as they open the menu so "Event admin" shows for admins
    fetchEventAdminStatus();
  };

  return (
    <>
      <TouchableOpacity onPress={openMenu} style={styles.trigger} hitSlop={12}>
        <View>
          <Menu size={24} color={colors.text} />
          {unreadNotifications > 0 && (
            <View style={styles.badgeDot} pointerEvents="none">
              <Text style={styles.badgeDotText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.drawer, { width: menuWidth, paddingTop: insets.top }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Menu</Text>
              <TouchableOpacity onPress={close} hitSlop={12}>
                <X size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.menuList} showsVerticalScrollIndicator={false}>
              <MenuItem icon={Home} label="Info" onPress={() => navigate('/(tabs)/home')} />
              <MenuItem icon={ImageIcon} label="Feed" onPress={() => navigate('/(tabs)/feed')} />
              <MenuItem icon={Calendar} label="Agenda" onPress={() => navigate('/(tabs)/schedule')} />
              <MenuItem icon={Users} label="Community" onPress={() => navigate('/(tabs)/community')} />
              <MenuItem icon={Trophy} label="Rank" onPress={() => navigate('/(tabs)/leaderboard')} />
              <MenuItem icon={LayoutGrid} label="Photo book" onPress={() => navigate('/(tabs)/photo-book')} />
              <MenuItem icon={Store} label="B2B" onPress={() => navigate('/(tabs)/expo')} />
              <MenuItem icon={Tv} label="Live wall" onPress={openLiveWall} />
              <View style={styles.divider} />
              <MenuItem
                icon={User}
                label="My profile"
                onPress={() => navigate('/(tabs)/profile')}
              />
              <MenuItem
                icon={Edit3}
                label="Edit profile"
                onPress={() => navigateToProfileScreen('/profile/edit')}
              />
              <MenuItem
                icon={Bell}
                label="Notifications"
                badge={unreadNotifications > 0 ? unreadNotifications : undefined}
                onPress={() => navigateToProfileScreen('/profile/notifications')}
              />
              {(isEventAdmin || isPlatformAdmin) && user && (
                <MenuItem
                  icon={Shield}
                  label="Event admin"
                  onPress={() => navigateToProfileScreen('/profile/admin')}
                />
              )}
              <View style={styles.divider} />
              <MenuItem
                icon={LogOut}
                label="Logout"
                onPress={handleLogout}
                labelStyle={styles.logoutLabel}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  labelStyle,
  badge,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  labelStyle?: object;
  badge?: number;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Icon size={22} color={colors.textSecondary} />
      <Text style={[styles.menuItemLabel, labelStyle]}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      <ChevronRight size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: {
    padding: 8,
    marginLeft: 4,
  },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    backgroundColor: colors.background,
    marginRight: 0,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  menuList: {
    flex: 1,
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 14,
  },
  menuItemLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  logoutLabel: {
    color: colors.danger,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
    marginHorizontal: 20,
  },
});
