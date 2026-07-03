/**
 * B2B meeting times — same wall-clock model as agenda sessions (Schedule.tsx).
 * Enter 1:05 PM → stored as 13:05 UTC → everyone sees 1:05 PM.
 */

import { DateTime } from 'luxon';

function normalizeIso(iso: string): string {
  const trimmed = iso.trim();
  return /^\d{4}-\d{2}-\d{2}\s/.test(trimmed) ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T') : trimmed;
}

function parseIso(iso: string): Date | null {
  const d = new Date(normalizeIso(iso));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function utcIsoToDatetimeLocalWallClock(iso: string): string {
  const d = parseIso(iso);
  if (!d) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function datetimeLocalToUtcIsoWallClock(localValue: string): string | null {
  const value = localValue.trim();
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [ys, ms, ds] = (datePart || '').split('-');
  const y = parseInt(ys ?? '0', 10) || 0;
  const mo = parseInt(ms ?? '1', 10) || 1;
  const d = parseInt(ds ?? '1', 10) || 1;
  const [hStr, minStr] = (timePart || '').split(':');
  const hh = parseInt(hStr ?? '0', 10) || 0;
  const mm = parseInt(minStr ?? '0', 10) || 0;
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, 0, 0)).toISOString();
}

export function addMinutesToDatetimeLocalWallClock(startValue: string, minutes: number): string {
  const iso = datetimeLocalToUtcIsoWallClock(startValue);
  if (!iso) return '';
  const d = parseIso(iso)!;
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return utcIsoToDatetimeLocalWallClock(d.toISOString());
}

function formatWallClockTime12(iso: string): string {
  const d = parseIso(iso);
  if (!d) return '—';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatB2BSlotRangeWallClock(startIso: string, endIso: string): string {
  const d1 = parseIso(startIso);
  if (!d1) return '—';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const head = `${days[d1.getUTCDay()]}, ${mons[d1.getUTCMonth()]} ${d1.getUTCDate()} · ${formatWallClockTime12(startIso)}`;
  return `${head} – ${formatWallClockTime12(endIso)}`;
}

export function formatB2BWhenLabelWallClock(iso: string): string {
  const d = parseIso(iso);
  if (!d) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]}, ${mons[d.getUTCMonth()]} ${d.getUTCDate()}, ${formatWallClockTime12(iso)}`;
}

function getDateKeyFromIso(iso: string): string | null {
  const d = parseIso(iso);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True after slot end at venue (uses reminder_timezone for live/past, not display). */
export function isB2BSlotPastWallClock(
  startIso: string,
  endIso: string,
  eventIanaZone?: string | null
): boolean {
  const end = parseIso(endIso);
  if (!end) return false;
  const dateKey = getDateKeyFromIso(startIso);
  if (!dateKey) return false;
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const zone = (eventIanaZone ?? '').trim() || 'America/New_York';
  const dt = DateTime.fromObject(
    {
      year: parseInt(m[1]!, 10),
      month: parseInt(m[2]!, 10),
      day: parseInt(m[3]!, 10),
      hour: end.getUTCHours(),
      minute: end.getUTCMinutes(),
      second: 0,
      millisecond: 0,
    },
    { zone },
  );
  if (!dt.isValid) return false;
  return Date.now() > dt.toMillis();
}

/** @deprecated tz ignored — use utcIsoToDatetimeLocalWallClock */
export const utcIsoToEventDatetimeLocal = utcIsoToDatetimeLocalWallClock;
/** @deprecated tz ignored — use datetimeLocalToUtcIsoWallClock */
export const eventDatetimeLocalToUtcIso = (local: string, _tz?: string | null) =>
  datetimeLocalToUtcIsoWallClock(local);
/** @deprecated tz ignored */
export const addMinutesToEventDatetimeLocal = (start: string, minutes: number, _tz?: string | null) =>
  addMinutesToDatetimeLocalWallClock(start, minutes);
/** @deprecated tz ignored — use formatB2BSlotRangeWallClock */
export const formatB2BSlotRangeInEventZone = (start: string, end: string, _tz?: string | null) =>
  formatB2BSlotRangeWallClock(start, end);
/** @deprecated tz ignored */
export const formatB2BWhenLabel = (iso: string, _tz?: string | null) => formatB2BWhenLabelWallClock(iso);
