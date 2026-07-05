import type { Event } from './types';

export type PortalHeroEvent = Pick<
  Event,
  'name' | 'portal_banner_url' | 'badge_banner_url' | 'banner_url' | 'logo_url'
>;

/** Photo-style headers are wide and tall enough to full-bleed; logos are shorter. */
export function isWidePortalBannerImage(naturalWidth: number, naturalHeight: number): boolean {
  const height = Math.max(naturalHeight, 1);
  const aspect = naturalWidth / height;
  return height >= 220 && aspect >= 2.2;
}

/** Preferred wide banner URL before client-side dimension checks. */
export function portalWideBannerCandidate(ev: PortalHeroEvent): string | null {
  const portal = (ev.portal_banner_url ?? '').trim();
  if (portal) return portal;
  const badge = (ev.badge_banner_url ?? '').trim();
  if (badge) return badge;
  return null;
}

/** Logo for the gradient header card when no wide banner applies. */
export function portalLogoCandidate(ev: PortalHeroEvent): string | null {
  const logo = (ev.logo_url ?? '').trim();
  if (logo) return logo;
  const banner = (ev.banner_url ?? '').trim();
  if (banner) return banner;
  return null;
}

/** App Info banner — only used if dimensions qualify as wide on load. */
export function portalAppBannerCandidate(ev: PortalHeroEvent): string | null {
  return (ev.banner_url ?? '').trim() || null;
}
