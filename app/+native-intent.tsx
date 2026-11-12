import { isBadgeDeepLinkUrl, parseBadgeTokenFromQrData } from '../lib/badgeRpc';
import { setPendingBadgeToken } from '../lib/pendingBadgeUrl';
import { isPasswordRecoveryLaunchUrl } from '../lib/passwordRecoveryLaunchUrl';
import { setPendingPasswordRecoveryUrl } from '../lib/pendingRecoveryUrl';

function extractBadgeToken(path: string): string | null {
  const raw = (path || '').trim();
  if (!raw) return null;

  const direct = parseBadgeTokenFromQrData(raw);
  if (direct) return direct;

  // Expo Router often passes "/badge?t=…" without a scheme.
  const asScheme = raw.includes('://') ? raw : `collectivelive://${raw.replace(/^\//, '')}`;
  const fromScheme = parseBadgeTokenFromQrData(asScheme);
  if (fromScheme) return fromScheme;

  try {
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    if (!q) return null;
    const params = new URLSearchParams(q);
    const t = (params.get('t') || params.get('token') || '').trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Rewrite camera QR cold-starts onto a real route before Expo Router mounts. */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const token = extractBadgeToken(path);
    const looksBadge =
      isBadgeDeepLinkUrl(path) ||
      isBadgeDeepLinkUrl(`collectivelive://${path.replace(/^\//, '')}`) ||
      /(^|\/)badge(\?|$|\/)/i.test(path);

    if (token && looksBadge) {
      setPendingBadgeToken(token);
      return `/badge?t=${encodeURIComponent(token)}`;
    }

    const asScheme = path.includes('://') ? path : `collectivelive://${path.replace(/^\//, '')}`;
    const looksRecovery =
      isPasswordRecoveryLaunchUrl(asScheme) ||
      isPasswordRecoveryLaunchUrl(path) ||
      /(^|\/)reset-password(\?|$|\/|#)/i.test(path);
    if (looksRecovery) {
      if (isPasswordRecoveryLaunchUrl(asScheme)) {
        setPendingPasswordRecoveryUrl(asScheme);
      } else if (isPasswordRecoveryLaunchUrl(path)) {
        setPendingPasswordRecoveryUrl(path);
      }
      return '/reset-password';
    }

    // Never leave cold-start deep links on unknown paths stuck under the splash.
    if (initial && looksBadge && !token) {
      return '/';
    }

    return path;
  } catch {
    return '/';
  }
}
