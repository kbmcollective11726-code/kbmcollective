/** Deep link encoded in printed badge QR codes — opens KBM Connect badge scan (role-based UI). */
export function badgeQrPayload(token: string): string {
  return `collectivelive://badge?t=${encodeURIComponent(token.trim())}`;
}

export function badgeAppDeepLink(token: string): string {
  return badgeQrPayload(token);
}

/** Optional https landing (legacy reprints); normal badges use {@link badgeQrPayload}. */
export function badgeHttpsLandingUrl(token: string): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin.replace(/\/+$/, '')
      : 'https://cadmin.kbmcollective.org';
  return `${origin}/badge?t=${encodeURIComponent(token.trim())}`;
}
