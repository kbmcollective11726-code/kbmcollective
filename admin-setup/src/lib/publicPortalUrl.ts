/** Public registration + delegate/vendor portal base URL (connect.kbmcollective.org). */
const DEFAULT_CONNECT_BASE = 'https://connect.kbmcollective.org';

export function getPublicPortalBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_PORTAL_URL as string | undefined)?.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.location.hostname === 'connect.kbmcollective.org') {
    return window.location.origin.replace(/\/+$/, '');
  }
  return DEFAULT_CONNECT_BASE;
}

export function publicRegisterUrl(
  eventId: string,
  audience: 'delegate' | 'vendor' | 'speaker',
  formSlug?: string | null,
): string {
  const base = `${getPublicPortalBaseUrl()}/register/${eventId}/${audience}`;
  const slug = (formSlug ?? '').trim();
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

/** Public event website (Standard registration). */
export function publicEventSiteUrl(slug: string): string {
  return `${getPublicPortalBaseUrl()}/e/${encodeURIComponent(slug.trim())}`;
}

export function publicPortalLoginUrl(eventId: string, role: 'delegate' | 'vendor'): string {
  return `${getPublicPortalBaseUrl()}/portal/${eventId}/${role}/login`;
}

export function publicPortalRegistrationUrl(eventId: string, role: 'delegate' | 'vendor'): string {
  return `${getPublicPortalBaseUrl()}/portal/${eventId}/${role}/registration`;
}

export function publicPortalSetPasswordUrl(eventId: string, role: 'delegate' | 'vendor'): string {
  return `${getPublicPortalBaseUrl()}/portal/${eventId}/${role}/set-password`;
}
