import {
  getSessionDateKeyFromIso,
  parseSessionDate,
  sessionInstantOnEventDayLocal,
} from './scheduleNowNext';
import type { EventSponsor, EventSponsorCreative } from './types';

export type SponsorWithCreatives = EventSponsor & {
  creatives?: EventSponsorCreative[] | null;
};

function wallClockIsoToInstant(iso: string, eventIanaZone?: string | null): Date | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  const dateKey = getSessionDateKeyFromIso(iso);
  if (!dateKey) return null;
  return sessionInstantOnEventDayLocal(d, dateKey, eventIanaZone);
}

/** True when `now` falls inside the creative window (event timezone when set). */
export function isSponsorCreativeActiveNow(
  creative: Pick<EventSponsorCreative, 'starts_at' | 'ends_at'>,
  eventIanaZone?: string | null,
  now: Date = new Date()
): boolean {
  const start = wallClockIsoToInstant(creative.starts_at, eventIanaZone);
  const end = wallClockIsoToInstant(creative.ends_at, eventIanaZone);
  if (!start || !end) return false;
  const t = now.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function pickActiveSponsorCreative(
  creatives: EventSponsorCreative[] | null | undefined,
  eventIanaZone?: string | null,
  now: Date = new Date()
): EventSponsorCreative | null {
  if (!creatives?.length) return null;
  const active = creatives
    .filter((c) => isSponsorCreativeActiveNow(c, eventIanaZone, now))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.starts_at.localeCompare(b.starts_at);
    });
  return active[0] ?? null;
}

/** Replace logo and click URL with the active scheduled creative when one applies. */
export function resolveSponsorDisplayLogo<T extends EventSponsor>(
  sponsor: T,
  eventIanaZone?: string | null,
  now: Date = new Date()
): T {
  const withCreatives = sponsor as T & { creatives?: EventSponsorCreative[] | null };
  const active = pickActiveSponsorCreative(withCreatives.creatives, eventIanaZone, now);
  if (!active?.image_url?.trim()) return sponsor;
  const creativeUrl = active.website_url?.trim() || null;
  return {
    ...sponsor,
    logo_url: active.image_url.trim(),
    website_url: creativeUrl || sponsor.website_url,
  };
}

export function applyScheduledSponsorLogos<T extends SponsorWithCreatives>(
  sponsors: T[],
  eventIanaZone?: string | null,
  now: Date = new Date()
): EventSponsor[] {
  return sponsors.map((s) => {
    const resolved = resolveSponsorDisplayLogo(s, eventIanaZone, now);
    const { creatives: _c, ...rest } = resolved as T & { creatives?: EventSponsorCreative[] | null };
    return rest;
  });
}

export const EVENT_SPONSORS_WITH_CREATIVES_SELECT = `
  id,
  company_name,
  logo_url,
  website_url,
  tier_label,
  sort_order,
  show_on_info_screen,
  show_in_hamburger,
  show_in_hamburger_header,
  show_in_hamburger_footer,
  show_on_schedule,
  show_on_feed,
  show_on_live_wall,
  is_active,
  creatives:event_sponsor_creatives (
    id,
    sponsor_id,
    event_id,
    image_url,
    website_url,
    label,
    starts_at,
    ends_at,
    sort_order
  )
`;

export type SponsorPlacement =
  | 'info'
  | 'feed'
  | 'schedule'
  | 'hamburger_header'
  | 'hamburger_footer'
  | 'live_wall';

export function sponsorMatchesPlacement(sponsor: EventSponsor, placement: SponsorPlacement): boolean {
  switch (placement) {
    case 'info':
      return !!sponsor.show_on_info_screen;
    case 'feed':
      return !!sponsor.show_on_feed;
    case 'schedule':
      return !!sponsor.show_on_schedule;
    case 'hamburger_header':
      return !!(sponsor.show_in_hamburger_header ?? sponsor.show_in_hamburger);
    case 'hamburger_footer':
      return !!(sponsor.show_in_hamburger_footer ?? sponsor.show_in_hamburger);
    case 'live_wall':
      return !!sponsor.show_on_live_wall;
    default:
      return false;
  }
}
