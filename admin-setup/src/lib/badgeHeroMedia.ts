import type { Event } from './types';

export type BadgeHeroMedia = { src: string; kind: 'badge-banner' | 'banner' | 'logo' };

/** Badge header: dedicated strip → app banner → logo. */
export function badgeHeroMedia(ev: Event | null): BadgeHeroMedia | null {
  if (!ev) return null;
  const badgeBanner = (ev.badge_banner_url ?? '').trim();
  if (badgeBanner) return { src: badgeBanner, kind: 'badge-banner' };
  const banner = (ev.banner_url ?? '').trim();
  if (banner) return { src: banner, kind: 'banner' };
  const logo = (ev.logo_url ?? '').trim();
  if (logo) return { src: logo, kind: 'logo' };
  return null;
}

export function badgeHeroSourceLabel(ev: Event | null): string {
  const hero = badgeHeroMedia(ev);
  if (!hero) return 'No header image (upload badge header or set banner/logo on event)';
  if (hero.kind === 'badge-banner') return 'Using badge header image';
  if (hero.kind === 'banner')
    return 'Using app Info banner — side gaps and cropping are likely. Upload a badge header image above.';
  return 'Using event logo';
}
