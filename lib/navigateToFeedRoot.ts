import { router } from 'expo-router';

type NavLike = {
  navigate: (name: string, params?: object) => void;
  getState?: () => { routeNames?: string[]; type?: string; index?: number; routes?: { name?: string }[] } | undefined;
  getParent?: () => NavLike | undefined;
};

/** Walk up to the tabs navigator that owns the `feed` route. */
function findTabsNavigation(navigation?: NavLike): NavLike | undefined {
  let current = navigation;
  for (let i = 0; i < 8 && current; i += 1) {
    const names = current.getState?.()?.routeNames ?? [];
    if (names.includes('feed') && (names.includes('home') || names.includes('community'))) {
      return current;
    }
    current = current.getParent?.();
  }
  return undefined;
}

function isOnFeedTab(navigation?: NavLike): boolean {
  let current = navigation;
  for (let i = 0; i < 8 && current; i += 1) {
    const state = current.getState?.();
    const names = state?.routeNames ?? [];
    if (names.includes('feed') && (names.includes('home') || names.includes('community'))) {
      const idx = state?.index ?? 0;
      const routeName = state?.routes?.[idx]?.name;
      return routeName === 'feed';
    }
    current = current.getParent?.();
  }
  return false;
}

/**
 * Open the main feed list and clear nested feed screens (user profile, comments).
 *
 * Important: do NOT call router.dismissAll() while on the Profile tab — that only
 * clears the profile stack, then replace('/(tabs)/feed') can restore a leftover
 * feed/user route. Always target the feed tab's `index` screen explicitly.
 *
 * Also avoid router.dismissTo as the primary cross-tab path — when you are on
 * Community / Agenda / etc., dismissTo('(tabs)/feed') often no-ops and the
 * hamburger “Feed” item appears broken.
 */
export function navigateToFeedRoot(navigation?: unknown): void {
  const nav = navigation as NavLike | undefined;
  const tabNav = findTabsNavigation(nav);
  if (tabNav) {
    try {
      // Forces the feed stack onto its root list screen (not feed/user/...).
      tabNav.navigate('feed', { screen: 'index' });
      return;
    } catch {
      /* fall through to router */
    }
  }

  // Only dismiss within the feed stack when we know we are already on that tab.
  if (isOnFeedTab(nav) && typeof router.dismissTo === 'function') {
    try {
      router.dismissTo('/(tabs)/feed' as never);
      return;
    } catch {
      /* fall through */
    }
  }

  try {
    router.navigate('/(tabs)/feed' as never);
    return;
  } catch {
    /* fall through */
  }

  try {
    router.push('/(tabs)/feed' as never);
  } catch {
    try {
      router.replace('/(tabs)/feed' as never);
    } catch {
      /* navigator not ready */
    }
  }
}
