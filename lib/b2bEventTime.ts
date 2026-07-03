/**
 * B2B meeting times use the same wall-clock model as agenda sessions:
 * store UTC fields whose H:M match what admins enter; display reads UTC components (no TZ conversion).
 */

function normalizeIso(iso: string): string {
  const trimmed = iso.trim();
  return /^\d{4}-\d{2}-\d{2}\s/.test(trimmed) ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T') : trimmed;
}

function parseIso(iso: string): Date | null {
  const d = new Date(normalizeIso(iso));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** DB ISO → datetime-local (UTC wall-clock, same as Schedule admin). */
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

/** datetime-local → UTC ISO for DB (wall-clock, not device/event TZ). */
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

/** Single time — same numbers as agenda `formatSessionTime`. */
export function formatB2BSlotTimeWallClock(iso: string): string {
  return formatWallClockTime12(iso);
}

/** Range line — same as agenda session cards in admin. */
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

/** React Native picker ↔ DB (wall-clock; picker fields = venue clock numbers). */
export function b2bUtcIsoToPickerDate(iso: string): Date | null {
  const d = parseIso(iso);
  if (!d) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), 0, 0);
}

export function b2bPickerDateToUtcIso(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0)
  ).toISOString();
}

/** @deprecated Use wall-clock helpers; tz arg ignored. */
export const utcIsoToEventDatetimeLocal = utcIsoToDatetimeLocalWallClock;
/** @deprecated Use wall-clock helpers; tz arg ignored. */
export const eventDatetimeLocalToUtcIso = (local: string, _tz?: string | null) =>
  datetimeLocalToUtcIsoWallClock(local);
/** @deprecated Use wall-clock helpers; tz arg ignored. */
export const addMinutesToEventDatetimeLocal = (start: string, minutes: number, _tz?: string | null) =>
  addMinutesToDatetimeLocalWallClock(start, minutes);
/** @deprecated Use formatB2BSlotTimeWallClock; tz arg ignored. */
export const formatB2BSlotTimeInEventZone = (iso: string, _tz?: string | null) =>
  formatB2BSlotTimeWallClock(iso);
/** @deprecated Use formatB2BSlotRangeWallClock; tz arg ignored. */
export const formatB2BSlotRangeInEventZone = (start: string, end: string, _tz?: string | null) =>
  formatB2BSlotRangeWallClock(start, end);
/** @deprecated Use formatB2BWhenLabelWallClock; tz arg ignored. */
export const formatB2BWhenLabel = (iso: string, _tz?: string | null) => formatB2BWhenLabelWallClock(iso);
