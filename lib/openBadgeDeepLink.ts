import type { Router } from 'expo-router';
import { resolveBadgeToken } from './badgeRpc';
import { ensureCurrentEventForId } from './ensureEventForNotification';
import {
  consumePendingBadgeToken,
  peekPendingBadgeToken,
  setPendingBadgeToken,
} from './pendingBadgeUrl';
import { safeRouterReplace } from './safeNavigate';
import { useAuthStore } from '../stores/authStore';

export function isBadgeScanPath(pathname: string | undefined): boolean {
  return !!pathname && pathname.includes('badge-scan');
}

export function badgeScanHref(token: string): `/(tabs)/profile/badge-scan?t=${string}` {
  return `/(tabs)/profile/badge-scan?t=${encodeURIComponent(token)}` as `/(tabs)/profile/badge-scan?t=${string}`;
}

/** Open badge-scan for a QR/deep-link token; switches event when possible. Keeps token pending until navigation. */
export async function openBadgeDeepLink(router: Router, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) return;

  setPendingBadgeToken(trimmed);

  const { isAuthenticated, user } = useAuthStore.getState();
  if (!isAuthenticated) {
    safeRouterReplace(router, '/(auth)/login');
    return;
  }

  try {
    const { data } = await resolveBadgeToken(trimmed);
    if (data?.event_id) {
      await ensureCurrentEventForId(data.event_id, user?.is_platform_admin === true);
    }
  } catch {
    /* still open badge-scan — screen shows RPC error if needed */
  }

  consumePendingBadgeToken();
  safeRouterReplace(router, badgeScanHref(trimmed));
}

export async function tryOpenPendingBadgeDeepLink(router: Router): Promise<boolean> {
  const token = peekPendingBadgeToken();
  if (!token) return false;
  await openBadgeDeepLink(router, token);
  return true;
}
