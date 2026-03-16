import { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar, User, ImageIcon, Trophy, Users, Store } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import JoinEventGate from '../../components/JoinEventGate';
import { colors } from '../../constants/colors';
import PostFAB from '../../components/PostFAB';
import HamburgerMenu from '../../components/HamburgerMenu';
import AnnouncementBanner from '../../components/AnnouncementBanner';
import HeaderNotificationBell from '../../components/HeaderNotificationBell';
import DebugPanel from '../../components/DebugPanel';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/profile')}
      style={headerStyles.profileBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <User size={24} color={colors.primary} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const headerStyles = StyleSheet.create({
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileBtn: {
    marginRight: 8,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const tabIcons: Record<string, (props: { color: string; size: number }) => React.ReactNode> = {
  index: Home,
  home: Home,
  feed: ImageIcon,
  community: Users,
  schedule: Calendar,
  leaderboard: Trophy,
  profile: User,
  'photo-book': ImageIcon,
  expo: Store,
};

const tabTitles: Record<string, string> = {
  index: 'Info',
  home: 'Info',
  feed: 'Feed',
  community: 'Community',
  schedule: 'Agenda',
  leaderboard: 'Rank',
  profile: 'Profile',
  'photo-book': 'Photo book',
  expo: 'B2B',
};

const tabBarLabels: Record<string, string> = {
  index: 'Info',
  home: 'Info',
  feed: 'Feed',
  community: 'Community',
  schedule: 'Agenda',
  leaderboard: 'Rank',
  expo: 'B2B',
};

const HIDDEN_FROM_TABS = ['profile', 'photo-book', 'expo'];

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { currentEvent, memberships, fetchMyMemberships } = useEventStore();
  const [eventCheckDone, setEventCheckDone] = useState(false);

  // If user logs out while on tabs, go to login (backup for logout links that might not navigate)
  useEffect(() => {
    if (user === null) {
      router.replace('/(auth)/login');
    }
  }, [user, router]);

  // Load memberships as soon as user exists so we set currentEvent from storage / API. Only then decide if we need the event-code screen (avoids flashing event code page after login).
  useEffect(() => {
    if (!user?.id) {
      setEventCheckDone(false);
      return;
    }
    let cancelled = false;
    fetchMyMemberships(user.id, user?.is_platform_admin).then(() => {
      if (!cancelled) setEventCheckDone(true);
    });
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setEventCheckDone(true);
    }, 15000);
    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  const tabBarPaddingBottom = Math.max(insets.bottom, 8);
  const topPadding = 0;
  // Only show event-code gate after we've tried loading their event (stops brief flash of event code screen after login).
  const needsEventCode = eventCheckDone && user && !currentEvent && !user.is_platform_admin;
  const showPostFAB = !pathname?.includes('/chat/') && !pathname?.includes('/feed/user/');

  if (user && !eventCheckDone) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, fontSize: 16, color: colors.textSecondary }}>Loading…</Text>
      </View>
    );
  }

  if (needsEventCode) {
    return <JoinEventGate />;
  }

  return (
    <View style={{ flex: 1, paddingTop: topPadding, backgroundColor: colors.background }}>
      <AnnouncementBanner />
      <Tabs
        screenOptions={({ route }) => {
          const name = route.name === 'index' ? 'index' : route.name;
          const Icon = tabIcons[name] ?? User;
          const isInfoTab = name === 'index' || name === 'home';
          // Page header title: always "Info" on Info tab to match page name, else tab title
          const title = isInfoTab ? 'Info' : (tabTitles[name] ?? route.name);
          // Bottom tab label: always "Info" for Info tab (KBM menu under house)
          const tabLabel = isInfoTab ? 'Info' : (tabBarLabels[name] ?? title);
          const isHidden = HIDDEN_FROM_TABS.includes(route.name);
          // Hide Tabs header when viewing user profile (feed/user/xxx) so only "Profile" header shows
          const headerShown = !pathname?.includes('/feed/user/');
          return {
            href: isHidden ? null : undefined,
            headerShown: route.name === 'feed' ? headerShown : true,
            headerStyle: {
              backgroundColor: colors.background,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderLight,
            },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleAlign: 'left',
            headerTitleStyle: { fontWeight: '700', fontSize: 18 },
            headerLeftContainerStyle: { paddingLeft: 16 },
            headerRightContainerStyle: { paddingRight: 16 },
            headerLeft: () => <HamburgerMenu />,
            headerRight: () => (
              <View style={headerStyles.headerRight}>
                <HeaderNotificationBell />
                <HeaderProfileButton />
              </View>
            ),
            title,
            tabBarLabel: isHidden ? '' : tabLabel,
            tabBarIcon: ({ color, size }: { color: string; size: number }) => <Icon color={color} size={size} />,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: tabBarPaddingBottom,
              minHeight: 56 + tabBarPaddingBottom,
            },
            tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
            // When Feed tab pressed: go to main feed (not feed/user/xxx). popToTopOnBlur pops when leaving.
            ...(route.name === 'feed' && { popToTopOnBlur: true }),
            ...(route.name === 'feed' && {
              listeners: {
                tabPress: (e: { preventDefault: () => void }) => {
                  e.preventDefault();
                  router.replace('/(tabs)/feed' as any);
                },
              },
            }),
          };
        }}
      >
        <Tabs.Screen name="profile" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="photo-book" options={{ href: null }} />
        <Tabs.Screen name="expo" options={{ href: null }} />
      </Tabs>
      {showPostFAB ? <PostFAB /> : null}
      {__DEV__ ? <DebugPanel /> : null}
    </View>
  );
}
