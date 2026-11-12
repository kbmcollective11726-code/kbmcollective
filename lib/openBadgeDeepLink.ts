import { resolveBadgeToken } from './badgeRpc';
import { ensureCurrentEventForId } from './ensureEventForNotification';
import {
  consumePendingBadgeToken,
  peekPendingBadgeToken,
  setPendingBadgeToken,
} from './pendingBadgeUrl';
import { safeRouterReplace, type RouterLike } from './safeNavigate';
import { useAuthStore } from '../stores/authStore';

const RESOLVE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(null);
      });
  });
}

export function isBadgeScanPath(pathname: string | undefined): boolean {
  return !!pathname && pathname.includes('badge-scan');
}

export function badgeScanHref(token: string): `/(tabs)/profile/badge-scan?t=${string}` {
  return `/(tabs)/profile/badge-scan?t=${encodeURIComponent(token)}` as `/(tabs)/profile/badge-scan?t=${string}`;
}

/** Open badge-scan for a QR/deep-link token; switches event when possible. Keeps token pending until navigation. */
export async function openBadgeDeepLink(router: RouterLike, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) return;

  setPendingBadgeToken(trimmed);

  const { isAuthenticated, user } = useAuthStore.getState();
  if (!isAuthenticated) {
    safeRouterReplace(router, '/(auth)/login');
    return;
  }

  try {
    const resolved = await withTimeout(resolveBadgeToken(trimmed), RESOLVE_TIMEOUT_MS);
    if (resolved?.data?.event_id) {
      await withTimeout(
        ensureCurrentEventForId(resolved.data.event_id, user?.is_platform_admin === true),
        RESOLVE_TIMEOUT_MS
      );
    }
  } catch {
    /* still open badge-scan — screen shows RPC error if needed */
  }

  consumePendingBadgeToken();
  safeRouterReplace(router, badgeScanHref(trimmed));
}

export async function tryOpenPendingBadgeDeepLink(router: RouterLike): Promise<boolean> {
  const token = peekPendingBadgeToken();
  if (!token) return false;
  await openBadgeDeepLink(router, token);
  return true;
}
