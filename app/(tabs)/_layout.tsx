import { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { Tabs, useRouter, usePathname, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Home, Calendar, User, ImageIcon, Trophy, Users, Store } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { registerRefetchOnSessionRefreshed } from '../../lib/onSessionRefreshed';
import { warmOfflineCaches } from '../../lib/offlineWarmup';
import { schedulePhoneReminders } from '../../lib/phoneReminders';
import JoinEventGate from '../../components/JoinEventGate';
import { colors } from '../../constants/colors';
import { flatNativeStackHeaderStyle } from '../../constants/headerStyle';
import PostFAB from '../../components/PostFAB';
import HamburgerMenu from '../../components/HamburgerMenu';
import AnnouncementBanner from '../../components/AnnouncementBanner';
import RolePreviewBanner from '../../components/RolePreviewBanner';
import OfflineBanner from '../../components/OfflineBanner';
import { useRolePreviewStore } from '../../stores/rolePreviewStore';
import HeaderNotificationBell from '../../components/HeaderNotificationBell';
import { isAppMenuItemVisible } from '../../lib/effectiveEventMenu';
import DeepLinkHandler from '../../components/DeepLinkHandler';
import { safeRouterReplace } from '../../lib/safeNavigate';
import { isBadgeScanPath } from '../../lib/openBadgeDeepLink';
import { peekPendingBadgeToken } from '../../lib/pendingBadgeUrl';
import {
  PLATFORM_ADMIN_ALL_EVENTS_HREF,
  consumePlatformAdminAllEventsLanding,
  isPlatformAdminAllEventsPath,
  peekPlatformAdminAllEventsLanding,
} from '../../lib/platformAdminNav';
import FloatingTabBar from '../../components/FloatingTabBar';
import ScreenAtmosphere from '../../components/ScreenAtmosphere';
import { useEventThemeColor } from '../../lib/eventTheme';

function HeaderProfileButton() {
  const router = useRouter();
  const themeColor = useEventThemeColor();
  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/profile')}
      style={headerStyles.profileBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.85}
    >
      <User size={22} color={themeColor} strokeWidth={1.75} />
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

const tabIcons: Record<
  string,
  (props: { color: string; size: number; strokeWidth?: number }) => React.ReactNode
> = {
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
  const { user, isLoading: authLoading, isAuthenticated, session, refreshUser } = useAuthStore();
  const { currentEvent, memberships, fetchMyMemberships } = useEventStore();
  const hydrateRolePreview = useRolePreviewStore((s) => s.hydrate);
  const rolePreviewHydrated = useRolePreviewStore((s) => s.hydrated);
  const [eventCheckDone, setEventCheckDone] = useState(false);

  useEffect(() => {
    if (!rolePreviewHydrated) void hydrateRolePreview();
  }, [rolePreviewHydrated, hydrateRolePreview]);

  useEffect(() => {
    if (!user?.id) return;
    return registerRefetchOnSessionRefreshed(() => {
      fetchMyMemberships(user.id, user.is_platform_admin)
        .then(() => setEventCheckDone(true))
        .catch(() => {});
    });
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  // Save key screens on the phone in the background (throttled) so they work during an outage,
  // and refresh phone-scheduled reminders so they still fire offline.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) return;
    const run = () => {
      const event = useEventStore.getState().currentEvent;
      const currentUser = useAuthStore.getState().user;
      if (!event || !currentUser) return;
      void warmOfflineCaches(event, currentUser.id);
      void schedulePhoneReminders(event, currentUser);
    };
    const startTimer = setTimeout(run, 4000);
    const unregister = registerRefetchOnSessionRefreshed(run);
    return () => {
      clearTimeout(startTimer);
      unregister();
    };
  }, [currentEvent?.id, user?.id]);

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
  const isPlatformAdmin = user?.is_platform_admin === true;
  const bypassEventGate =
    isBadgeScanPath(pathname) ||
    peekPendingBadgeToken() !== null ||
    (isPlatformAdmin && isPlatformAdminAllEventsPath(pathname));

  // If Agenda is disabled for this event, leave the tab screen (same flag as hamburger).
  useEffect(() => {
    if (!navigationReady || !hideAgendaTab || !isMainAgendaRoute(pathname)) return;
    safeRouterReplace(router, '/(tabs)/home' as any);
  }, [hideAgendaTab, pathname, router, navigationReady]);

  // Platform admins land on All events after sign-in, even if a previous event is still selected.
  useEffect(() => {
    if (!navigationReady || !isPlatformAdmin) return;
    if (isBadgeScanPath(pathname) || peekPendingBadgeToken()) return;
    if (isPlatformAdminAllEventsPath(pathname)) {
      consumePlatformAdminAllEventsLanding();
      return;
    }
    const landOnAllEvents = peekPlatformAdminAllEventsLanding() || !currentEvent;
    if (!landOnAllEvents) return;
    consumePlatformAdminAllEventsLanding();
    safeRouterReplace(router, PLATFORM_ADMIN_ALL_EVENTS_HREF);
  }, [navigationReady, isPlatformAdmin, currentEvent, pathname, router]);

  // Anyone else with no current event must enter an event code.
  const needsEventCode = eventCheckDone && user && !currentEvent && !isPlatformAdmin;
  // Hide post FAB in DMs, group chat, and feed user profile — avoids opening /post when sharing to chat.
  const showPostFAB =
    !pathname?.includes('/chat/') &&
    !pathname?.includes('/groups/') &&
    !pathname?.includes('/feed/user/');

  const waitingForEventCheck = !!user && !eventCheckDone && !bypassEventGate && !isPlatformAdmin;

  // Native splash stays up from cold start until tabs can draw real content (app/_layout has an 8s failsafe).
  useEffect(() => {
    if (waitingForEventCheck) return;
    const frame = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [waitingForEventCheck]);

  if (waitingForEventCheck) {
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
    <ScreenAtmosphere>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
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
              : ({ color, size, focused }) => (
                  <Icon
                    color={String(color)}
                    size={size}
                    strokeWidth={focused ? 2 : 1.5}
                  />
                ),
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: {
              backgroundColor: 'transparent',
              borderTopWidth: 0,
              elevation: 0,
            },
            tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
            sceneStyle: { backgroundColor: 'transparent' },
            // Drop nested children when leaving stacked tabs so the next visit is clean.
            // Feed / Expo / Profile tab presses also force root via FloatingTabBar.
            ...((route.name === 'feed' || route.name === 'expo' || route.name === 'profile') && {
              popToTopOnBlur: true,
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
      <OfflineBanner />
    </ScreenAtmosphere>
    </>
  );
}
