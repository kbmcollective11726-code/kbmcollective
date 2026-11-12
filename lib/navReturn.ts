/**
 * Shared back-navigation helpers so nested screens return to the place that
 * opened them, instead of drifting to Community / wrong tabs.
 */

export function firstRouteParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v[0];
}

/** Decode a `?from=` value into a usable in-app path. */
export function decodeReturnPath(from: string | string[] | undefined): string {
  const raw = firstRouteParam(from);
  if (!raw) return '';
  try {
    const decoded = decodeURIComponent(raw).trim();
    if (!decoded.startsWith('/') || decoded.includes('://')) return '';
    // Avoid `/groups/index` — Expo can treat `index` as `[groupId]` and break Back.
    return decoded.replace(/\/profile\/groups\/index(?=\?|$)/g, '/profile/groups');
  } catch {
    return '';
  }
}

type RouterLike = {
  replace: (href: never) => void;
  back: () => void;
  canGoBack?: () => boolean;
};

/**
 * Go back to `from` when present; otherwise stack back; otherwise a safe tab root.
 * Never defaults to Community — that caused unexpected back targets.
 */
export function navigateBackToFrom(
  router: RouterLike,
  from: string | string[] | undefined,
  fallbackHref: string = '/(tabs)/home'
): void {
  const returnPath = decodeReturnPath(from);
  if (returnPath) {
    router.replace(returnPath as never);
    return;
  }
  if (typeof router.canGoBack === 'function') {
    if (router.canGoBack()) {
      router.back();
      return;
    }
  } else {
    try {
      router.back();
      return;
    } catch {
      /* fall through */
    }
  }
  router.replace(fallbackHref as never);
}

/** Short profile path used inside chat `from` (matches existing route style). */
export function userProfilePath(userId: string, originalFrom?: string | null): string {
  if (originalFrom && originalFrom.trim()) {
    return `/feed/user/${userId}?from=${encodeURIComponent(originalFrom.trim())}`;
  }
  return `/feed/user/${userId}`;
}

/** Full href to open a user profile, optionally with return path. */
export function userProfileHref(userId: string, originalFrom?: string | null): string {
  const path = userProfilePath(userId, originalFrom);
  return path.startsWith('/(tabs)') ? path : `/(tabs)${path}`;
}

/**
 * Open chat and return directly to `originalFrom` on Back
 * (e.g. Community → Chat → Community).
 */
export function chatHref(userId: string, originalFrom?: string | null): string {
  const ret = (originalFrom ?? '').trim();
  if (ret) {
    return `/(tabs)/profile/chat/${userId}?from=${encodeURIComponent(ret)}`;
  }
  return `/(tabs)/profile/chat/${userId}`;
}

/**
 * Chat opened from a member profile: Back returns to that profile first,
 * then profile Back returns to the original source.
 */
export function chatHrefViaProfile(userId: string, originalFrom?: string | null): string {
  const profilePath = userProfilePath(userId, originalFrom);
  return `/(tabs)/profile/chat/${userId}?from=${encodeURIComponent(profilePath)}`;
}

/** Groups list href, optionally preserving where Groups was opened from.
 * Use `/groups` (not `/groups/index`) so Expo never treats `index` as a `[groupId]`.
 */
export function groupsListHref(originalFrom?: string | string[] | null): string {
  const ret = decodeReturnPath(originalFrom ?? undefined);
  if (ret) return `/(tabs)/profile/groups?from=${encodeURIComponent(ret)}`;
  return '/(tabs)/profile/groups';
}

/** Open a group chat so Back returns to the groups list (with its own `from`). */
export function groupChatHref(groupId: string, originalFrom?: string | string[] | null): string {
  return `/(tabs)/profile/groups/${groupId}?from=${encodeURIComponent(groupsListHref(originalFrom))}`;
}

/** New-group screen that returns to the groups list. */
export function newGroupHref(originalFrom?: string | string[] | null): string {
  return `/(tabs)/profile/groups/new?from=${encodeURIComponent(groupsListHref(originalFrom))}`;
}
