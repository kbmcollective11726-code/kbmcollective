import { parseISO } from 'date-fns';
import { DateTime } from 'luxon';

function parseSessionDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
    ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : trimmed;
  try {
    const d = parseISO(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function getSessionDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sessionInstantOnEventDayLocal(
  timeField: Date,
  eventDateKey: string,
  eventIanaZone?: string | null
): Date | null {
  const m = eventDateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const hour = timeField.getUTCHours();
  const minute = timeField.getUTCMinutes();
  const zone = (eventIanaZone ?? '').trim();
  if (zone) {
    const dt = DateTime.fromObject(
      { year: y, month: mo, day: d, hour, minute, second: 0, millisecond: 0 },
      { zone }
    );
    if (!dt.isValid) return null;
    return dt.toJSDate();
  }
  return new Date(y, mo - 1, d, hour, minute, 0, 0);
}

export interface LiveWallSponsorCreative {
  id: string;
  sponsor_id: string;
  event_id: string;
  image_url: string;
  label: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
}

export interface LiveWallSponsorRow {
  id: string;
  company_name: string;
  logo_url: string | null;
  website_url: string | null;
  tier_label: string | null;
  sort_order: number;
  creatives?: LiveWallSponsorCreative[] | null;
}

function wallClockIsoToInstant(iso: string, eventIanaZone?: string | null): Date | null {
  const d = parseSessionDate(iso);
  if (!d) return null;
  const dateKey = getSessionDateKeyFromIso(iso);
  if (!dateKey) return null;
  return sessionInstantOnEventDayLocal(d, dateKey, eventIanaZone);
}

function isCreativeActiveNow(
  creative: Pick<LiveWallSponsorCreative, 'starts_at' | 'ends_at'>,
  eventIanaZone?: string | null,
  now: Date = new Date()
): boolean {
  const start = wallClockIsoToInstant(creative.starts_at, eventIanaZone);
  const end = wallClockIsoToInstant(creative.ends_at, eventIanaZone);
  if (!start || !end) return false;
  const t = now.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function resolveLiveWallSponsorLogo(
  sponsor: LiveWallSponsorRow,
  eventIanaZone?: string | null,
  now: Date = new Date()
): LiveWallSponsorRow {
  const creatives = sponsor.creatives ?? [];
  if (!creatives.length) return sponsor;
  const active = creatives
    .filter((c) => isCreativeActiveNow(c, eventIanaZone, now))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.starts_at.localeCompare(b.starts_at);
    })[0];
  if (!active?.image_url?.trim()) return sponsor;
  return { ...sponsor, logo_url: active.image_url.trim() };
}

export function resolveLiveWallSponsors(
  sponsors: LiveWallSponsorRow[],
  eventIanaZone?: string | null,
  now: Date = new Date()
): LiveWallSponsorRow[] {
  return sponsors.map((s) => resolveLiveWallSponsorLogo(s, eventIanaZone, now));
}

export const LIVE_WALL_SPONSORS_SELECT = `
  id,
  company_name,
  logo_url,
  website_url,
  tier_label,
  sort_order,
  creatives:event_sponsor_creatives (
    id,
    sponsor_id,
    event_id,
    image_url,
    label,
    starts_at,
    ends_at,
    sort_order
  )
`;
