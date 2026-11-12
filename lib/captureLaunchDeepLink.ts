/**
 * Capture cold-start launch URL as early as possible (before OTA / auth).
 * Import from app/_layout.tsx so this runs before splash/OTA work.
 */
import * as Linking from 'expo-linking';
import { isBadgeDeepLinkUrl, parseBadgeTokenFromQrData } from './badgeRpc';
import { setPendingBadgeToken } from './pendingBadgeUrl';
import { isPasswordRecoveryLaunchUrl } from './passwordRecoveryLaunchUrl';
import { peekPendingPasswordRecoveryUrl, setPendingPasswordRecoveryUrl } from './pendingRecoveryUrl';

let capturePromise: Promise<string | null> | null = null;

function applyLaunchUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    if (isPasswordRecoveryLaunchUrl(url)) {
      setPendingPasswordRecoveryUrl(url);
      return url;
    }
    const badgeToken = parseBadgeTokenFromQrData(url);
    if (badgeToken && isBadgeDeepLinkUrl(url)) {
      setPendingBadgeToken(badgeToken);
      return url;
    }
  } catch {
    /* ignore */
  }
  return url;
}

/** Start capture once; returns the raw launch URL if any. */
export function captureLaunchDeepLink(): Promise<string | null> {
  if (!capturePromise) {
    capturePromise = Linking.getInitialURL()
      .then((url) => applyLaunchUrl(url))
      .catch(() => null);
  }
  return capturePromise;
}

// Kick off immediately on import.
void captureLaunchDeepLink();
