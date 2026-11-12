import { router } from 'expo-router';
import { navigateToFeedRoot } from './navigateToFeedRoot';

type NavLike = {
  navigate: (name: string, params?: object) => void;
  getState?: () => { routeNames?: string[]; type?: string; index?: number; routes?: { name?: string }[] } | undefined;
  getParent?: () => NavLike | undefined;
};

/** Walk up to the tabs navigator that owns the main app tabs. */
export function findTabsNavigation(navigation?: NavLike): NavLike | undefined {
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

const TAB_FALLBACK: Record<string, string> = {
  home: '/(tabs)/home',
  index: '/(tabs)/home',
  feed: '/(tabs)/feed',
  community: '/(tabs)/community',
  schedule: '/(tabs)/schedule',
  leaderboard: '/(tabs)/leaderboard',
  expo: '/(tabs)/expo',
  'photo-book': '/(tabs)/photo-book',
  profile: '/(tabs)/profile',
};

/**
 * Always open a main tab at its root screen.
 * Use from the floating tab bar so nested pages (chat, groups, booth detail,
 * feed/user) never leave a tab button as a no-op or stuck on a child screen.
 */
export function navigateToTabRoot(tabName: string, navigation?: unknown): void {
  const name = tabName === 'index' ? 'home' : tabName;
  if (name === 'feed') {
    navigateToFeedRoot(navigation);
    return;
  }

  const nav = navigation as NavLike | undefined;
  const tabNav = findTabsNavigation(nav);

  if (tabNav) {
    try {
      if (name === 'expo') {
        tabNav.navigate('expo', { screen: 'index' });
        return;
      }
      if (name === 'profile') {
        tabNav.navigate('profile', { screen: 'index' });
        return;
      }
      tabNav.navigate(name);
      return;
    } catch {
      /* fall through */
    }
  }

  const href = TAB_FALLBACK[name] ?? `/(tabs)/${name}`;
  try {
    router.navigate(href as never);
  } catch {
    try {
      router.push(href as never);
    } catch {
      /* navigator not ready */
    }
  }
}
