import { useState, useEffect } from 'react';
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
} from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase } from '../lib/supabase';
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
  const { user, logout } = useAuthStore();
  const { currentEvent } = useEventStore();

  useEffect(() => {
    if (!visible || !user?.id) return;
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .then(({ count }) => setUnreadNotifications(count ?? 0));
  }, [visible, user?.id]);

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
    await logout();
    onLogout?.();
    router.replace('/(auth)/login');
  };

  const openLiveWall = () => {
    close();
    const url = currentEvent?.id
      ? `${LIVE_WALL_BASE_URL}/wall?event=${currentEvent.id}`
      : LIVE_WALL_BASE_URL;
    Linking.openURL(url).catch(() => {});
  };

  const menuWidth = Math.min(width * 0.8, 320);

  return (
    <>
      <TouchableOpacity onPress={() => setVisible(true)} style={styles.trigger} hitSlop={12}>
        <Menu size={24} color={colors.text} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.drawer, { width: menuWidth }]}
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
              <MenuItem icon={Users} label="Community" onPress={() => navigate('/(tabs)/community')} />
              <MenuItem icon={Calendar} label="Agenda" onPress={() => navigate('/(tabs)/schedule')} />
              <MenuItem icon={Trophy} label="Rank" onPress={() => navigate('/(tabs)/leaderboard')} />
              <MenuItem icon={LayoutGrid} label="Photo book" onPress={() => navigate('/(tabs)/photo-book')} />
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
              {user && currentEvent && (
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
