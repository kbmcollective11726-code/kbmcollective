import { useEffect, useState, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Text, AppState, AppStateStatus } from 'react-native';
import { Tabs, useRouter, usePathname, useRootNavigationState } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar, User, ImageIcon, Trophy, Users, Store } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase } from '../../lib/supabase';
import { notifyAfterSessionRefreshed } from '../../lib/onSessionRefreshed';
import JoinEventGate from '../../components/JoinEventGate';
import { colors } from '../../constants/colors';
import { flatNativeStackHeaderStyle } from '../../constants/headerStyle';
import PostFAB from '../../components/PostFAB';
import HamburgerMenu from '../../components/HamburgerMenu';
import AnnouncementBanner from '../../components/AnnouncementBanner';
import RolePreviewBanner from '../../components/RolePreviewBanner';
import { useRolePreviewStore } from '../../stores/rolePreviewStore';
import HeaderNotificationBell from '../../components/HeaderNotificationBell';
import { isAppMenuItemVisible } from '../../lib/effectiveEventMenu';
import DeepLinkHandler from '../../components/DeepLinkHandler';
import { safeRouterReplace } from '../../lib/safeNavigate';
import { isBadgeScanPath } from '../../lib/openBadgeDeepLink';
import { peekPendingBadgeToken } from '../../lib/pendingBadgeUrl';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/profile')}
      style={headerStyles.profileBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.85}
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
  expo: '1:1 Meetings',
  'solution-providers': 'Solution Providers',
};

const tabBarLabels: Record<string, string> = {
  index: 'Info',
  home: 'Info',
  feed: 'Feed',
  community: 'Community',
  schedule: 'Agenda',
  leaderboard: 'Rank',
  expo: '1:1',
};

const HIDDEN_FROM_TABS = ['profile', 'photo-book', 'expo', 'solution-providers', 'solution-provider'];

function isTabHidden(routeName: string): boolean {
  if (HIDDEN_FROM_TABS.includes(routeName)) return true;
  // List + dynamic detail: Expo may register `solution-providers`, `solution-provider`, or `solution-provider/[boothId]`.
  if (routeName === 'solution-providers' || routeName.includes('solution-provider')) return true;
  return false;
}

/** Main Agenda tab route (not profile admin schedule tools). */
function isMainAgendaRoute(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === '/(tabs)/schedule' ||
    pathname.startsWith('/(tabs)/schedule?') ||
    pathname === '/schedule' ||
    pathname.startsWith('/schedule?')
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading, isAuthenticated, session, refreshUser } = useAuthStore();
  const { currentEvent, memberships, fetchMyMemberships } = useEventStore();
  const hydrateRolePreview = useRolePreviewStore((s) => s.hydrate);
  const rolePreviewHydrated = useRolePreviewStore((s) => s.hydrated);
  const [eventCheckDone, setEventCheckDone] = useState(false);
  const lastMembershipRefreshAt = useRef(0);
  const MEMBERSHIP_REFRESH_DEBOUNCE_MS = 5000;

  useEffect(() => {
    if (!rolePreviewHydrated) void hydrateRolePreview();
  }, [rolePreviewHydrated, hydrateRolePreview]);

  // When app comes back from background:
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || !user?.id) return;
      const now = Date.now();
      if (now - lastMembershipRefreshAt.current < MEMBERSHIP_REFRESH_DEBOUNCE_MS) return;
      lastMembershipRefreshAt.current = now;
      supabase.auth.refreshSession().finally(() => {
        fetchMyMemberships(user.id, user?.is_platform_admin).then(() => setEventCheckDone(true));
        notifyAfterSessionRefreshed();
      });
    });
    return () => sub.remove();
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  // If session ends while on tabs, go to login. Use isAuthenticated — not `user` (profile row):
  // session can be valid while profile is still null or loading; treating `user === null` as
  // signed-out sent people to login after idle/refresh (Android reports).
  useEffect(() => {
    if (!navigationReady || authLoading) return;
    if (!isAuthenticated) {
      safeRouterReplace(router, '/(auth)/login');
    }
  }, [isAuthenticated, router, navigationReady, authLoading]);

  // Session valid but profile row not loaded yet (or failed once): retry so event gate + tabs work.
  useEffect(() => {
    if (!isAuthenticated || authLoading || user?.id || !session?.user?.id) return;
    void refreshUser();
  }, [isAuthenticated, authLoading, user?.id, session?.user?.id, refreshUser]);

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
    }, 8000);
    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  const hideAgendaTab = !isAppMenuItemVisible(currentEvent, 'menu_show_agenda');
  const bypassEventGate = isBadgeScanPath(pathname) || peekPendingBadgeToken() !== null;

  // If Agenda is disabled for this event, leave the tab screen (same flag as hamburger).
  useEffect(() => {
    if (!navigationReady || !hideAgendaTab || !isMainAgendaRoute(pathname)) return;
    safeRouterReplace(router, '/(tabs)/home' as any);
  }, [hideAgendaTab, pathname, router, navigationReady]);

  const tabBarPaddingBottom = Math.max(insets.bottom, 8);
  const topPadding = 0;
  // No exception: anyone with no current event must enter an event code (including new signups and platform admins).
  const needsEventCode = eventCheckDone && user && !currentEvent;
  // Hide post FAB in DMs, group chat, and feed user profile — avoids opening /post when sharing to chat.
  const showPostFAB =
    !pathname?.includes('/chat/') &&
    !pathname?.includes('/groups/') &&
    !pathname?.includes('/feed/user/');

  if (user && !eventCheckDone && !bypassEventGate) {
    return (
      <>
        <DeepLinkHandler />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 12, fontSize: 16, color: colors.textSecondary }}>Loading…</Text>
        </View>
      </>
    );
  }

  if (needsEventCode && !bypassEventGate) {
    return (
      <>
        <DeepLinkHandler />
        <JoinEventGate />
      </>
    );
  }

  return (
    <>
    <DeepLinkHandler />
    <View style={{ flex: 1, paddingTop: topPadding, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={({ route }) => {
          const name = route.name === 'index' ? 'index' : route.name;
          const Icon = tabIcons[name] ?? User;
          const isInfoTab = name === 'index' || name === 'home';
          // Page header title: always "Info" on Info tab to match page name, else tab title
          const title = isInfoTab ? 'Info' : (tabTitles[name] ?? route.name);
          // Bottom tab label: always "Info" for Info tab (KBM menu under house)
          const tabLabel = isInfoTab ? 'Info' : (tabBarLabels[name] ?? title);
          const isHidden =
            isTabHidden(route.name) ||
            ((route.name === 'schedule' || name === 'schedule') && hideAgendaTab);
          // Hide tab header on feed sub-routes that have their own stack header (profile, comment thread)
          const headerShown =
            !pathname?.includes('/feed/user/') && !pathname?.includes('/feed/comment/');
          return {
            // Expo Router: do not combine `href` with `tabBarButton` on the same screen.
            href: isHidden ? null : undefined,
            headerShown: route.name === 'feed' ? headerShown : true,
            headerStyle: flatNativeStackHeaderStyle,
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
            // Hidden tabs (href null) should not render an icon; belt-and-suspenders if a slot still appears on a device.
            tabBarIcon: isHidden
              ? () => null
              : ({ color, size }: { color: string; size: number }) => <Icon color={color} size={size} />,
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
                  safeRouterReplace(router, '/(tabs)/feed' as any);
                },
              },
            }),
          };
        }}
      >
        {/*
          Order matters: list primary tabs in bar order so when Agenda is toggled back on it stays
          between Feed and Community (not first). Hidden tabs follow.
        */}
        <Tabs.Screen name="home" />
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="schedule" options={{ href: hideAgendaTab ? null : undefined }} />
        <Tabs.Screen name="community" />
        <Tabs.Screen name="leaderboard" />
        <Tabs.Screen name="profile" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="photo-book" options={{ href: null }} />
        <Tabs.Screen name="expo" options={{ href: null }} />
        <Tabs.Screen name="solution-providers" options={{ href: null }} />
        <Tabs.Screen name="solution-provider/[boothId]" options={{ href: null }} />
      </Tabs>
      {showPostFAB ? <PostFAB /> : null}
      <RolePreviewBanner />
      {/* After Tabs/FAB so Android draws on top (zIndex + elevation); same blue banner as iOS */}
      <AnnouncementBanner />
    </View>
    </>
  );
}
