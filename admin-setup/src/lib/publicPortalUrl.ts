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

export function publicRegisterUrl(eventId: string, audience: 'delegate' | 'vendor' | 'speaker'): string {
  return `${getPublicPortalBaseUrl()}/register/${eventId}/${audience}`;
}

export function publicPortalLoginUrl(eventId: string, role: 'delegate' | 'vendor'): string {
  return `${getPublicPortalBaseUrl()}/portal/${eventId}/${role}/login`;
}

export function publicPortalSetPasswordUrl(eventId: string, role: 'delegate' | 'vendor'): string {
  return `${getPublicPortalBaseUrl()}/portal/${eventId}/${role}/set-password`;
}
