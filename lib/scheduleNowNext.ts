import { parseISO } from 'date-fns';

/** Parses API date strings (PostgreSQL may return space instead of T). Preserves timezone (Z or +00). */
export function parseSessionDate(iso: string | null | undefined): Date | null {
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

/** Date key (yyyy-MM-dd) for a given day_number (1-based) using event start_date. */
export function getDateKeyForDayNumber(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string | null {
  if (!eventStartDate || typeof eventStartDate !== 'string' || dayNumber == null) return null;
  const match = String(eventStartDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = parseInt(y!, 10);
  const month = parseInt(m!, 10);
  const day = parseInt(d!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = new Date(year, month - 1, day);
  if (Number.isNaN(base.getTime())) return null;
  const sessionDate = new Date(base);
  sessionDate.setDate(sessionDate.getDate() + (dayNumber - 1));
  if (Number.isNaN(sessionDate.getTime())) return null;
  const y2 = sessionDate.getFullYear();
  const m2 = sessionDate.getMonth() + 1;
  const d2 = sessionDate.getDate();
  return `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
}

/** Today's calendar date in the device timezone (yyyy-MM-dd). Use everywhere we match "today" to an event day. */
export function getDeviceLocalDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** UTC calendar yyyy-MM-dd from session timestamp — must match Agenda tab filter (`schedule.tsx`). */
export function getSessionDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = parseSessionDate(iso);
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Event day indices 1..N from start_date through end_date (same as Agenda). */
export function getEventDayNumbers(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): number[] {
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') return [];
  const startStr = startDate.trim().split(/\s/)[0] ?? '';
  const endStr = endDate.trim().split(/\s/)[0] ?? '';
  const start = parseISO(startStr);
  const end = parseISO(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  if (endMs < startMs) return [];
  const days = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: Math.max(1, Math.min(days, 365)) }, (_, i) => i + 1);
}

/** Section title date, e.g. "Sat, Mar 22, 2026" (matches admin web + mobile agenda feel). */
export function formatDateKeyForDisplay(dateKey: string): string {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const d = parseInt(m[3]!, 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return dateKey;
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export interface AgendaDaySessionGroup<S extends { id: string; start_time: string } = { id: string; start_time: string }> {
  dayNum: number | null;
  dateLabel: string;
  dateKey: string;
  items: S[];
}

/**
 * Bucket sessions by agenda calendar day (same rule as admin web Schedule + mobile Agenda).
 * @param omitEmptyDays — if true, skip day sections with zero sessions (typical mobile Manage schedule).
 */
export function groupSessionsByAgendaDay<S extends { id: string; start_time: string }>(
  sessions: S[],
  eventStart: string | null | undefined,
  eventEnd: string | null | undefined,
  omitEmptyDays = true
): AgendaDaySessionGroup<S>[] {
  let dayNums = getEventDayNumbers(eventStart, eventEnd);
  if (dayNums.length === 0 && sessions.length > 0) {
    const set = new Set<number>();
    for (const s of sessions) {
      const n = Number((s as { day_number?: unknown }).day_number);
      if (Number.isFinite(n) && n >= 1) set.add(n);
    }
    dayNums = Array.from(set).sort((a, b) => a - b);
    if (dayNums.length === 0) dayNums = [1];
  }

  const rows: AgendaDaySessionGroup<S>[] = [];
  const assigned = new Set<string>();

  if (dayNums.length > 0 && eventStart) {
    for (const dayNum of dayNums) {
      const dateKey = getDateKeyForDayNumber(dayNum, eventStart);
      if (!dateKey) continue;
      const items = sessions
        .filter((s) => getSessionDateKeyFromIso(s.start_time) === dateKey)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (const s of items) assigned.add(s.id);
      if (omitEmptyDays && items.length === 0) continue;
      rows.push({
        dayNum,
        dateLabel: formatDateKeyForDisplay(dateKey),
        dateKey,
        items,
      });
    }
  }

  const orphans = sessions.filter((s) => !assigned.has(s.id));
  if (orphans.length > 0) {
    const byKey = new Map<string, S[]>();
    for (const s of orphans) {
      const k = getSessionDateKeyFromIso(s.start_time) ?? 'unknown';
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(s);
    }
    for (const k of Array.from(byKey.keys()).sort()) {
      const items = (byKey.get(k) ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
      rows.push({
        dayNum: null,
        dateLabel: k === 'unknown' ? 'Unknown date' : formatDateKeyForDisplay(k),
        dateKey: k,
        items,
      });
    }
  }

  return rows;
}

export interface SessionForNowNext {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  day_number: number;
  [key: string]: unknown;
}

/**
 * Agenda times use UTC *components* as wall-clock (see formatTime / getUTCHours), not true UTC instants.
 * Never compare raw start.getTime() to Date.now() — e.g. 11 AM Eastern is 15:00 UTC, which falls inside 13:00–17:00Z
 * ("1–5 PM" on the badge) and marks the wrong session "Live" in release/TestFlight builds.
 *
 * Build local instants on the event calendar day (same as "next session" ordering) and compare getTime().
 */
export function sessionInstantOnEventDayLocal(timeField: Date, eventDateKey: string): Date | null {
  const m = eventDateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  return new Date(y, mo - 1, d, timeField.getUTCHours(), timeField.getUTCMinutes(), 0, 0);
}

/**
 * DB → React Native date pickers: match list/Agenda display (`formatSessionTime` uses UTC H:M as wall-clock).
 * `new Date(iso)` alone would show the device's timezone offset (e.g. 2pm Z → 10am Eastern in the editor).
 */
export function sessionIsoToWallClockLocalDate(iso: string | null | undefined): Date | null {
  const d = parseSessionDate(iso ?? '');
  if (!d || Number.isNaN(d.getTime())) return null;
  const key = getSessionDateKeyFromIso(iso ?? '');
  if (!key) return null;
  return sessionInstantOnEventDayLocal(d, key);
}

/**
 * Date picker → DB: store timestamptz whose **UTC** calendar + clock match the picked local Y/M/D/H:M
 * (same convention as admin list + Agenda + `formatSessionTime`). Do not use `toISOString()` on a local Date.
 */
export function wallClockLocalPickerToSessionIso(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0)
  ).toISOString();
}

export function isSessionLiveWallClockOnEventDay(
  now: Date,
  start: Date,
  end: Date,
  eventDateKey: string
): boolean {
  const startL = sessionInstantOnEventDayLocal(start, eventDateKey);
  const endL = sessionInstantOnEventDayLocal(end, eventDateKey);
  if (!startL || !endL) return false;
  const t = now.getTime();
  if (endL.getTime() >= startL.getTime()) {
    return t >= startL.getTime() && t <= endL.getTime();
  }
  return t >= startL.getTime() || t <= endL.getTime();
}

/** B2B meeting_slots use real UTC instants (`toISOString()` from pickers). Compare with true timestamps. */
export function isSessionLiveInstant(now: Date, start: Date, end: Date): boolean {
  const t = now.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** B2B / real-ISO end: session not over yet (for scroll-to-now). */
export function isSessionNotYetEndedInstant(now: Date, end: Date): boolean {
  return now.getTime() <= end.getTime();
}

/** Scroll / "not past": schedule session end as local instant on event day. */
export function isSessionNotYetEndedWallClockOnEventDay(now: Date, end: Date, eventDateKey: string): boolean {
  const endL = sessionInstantOnEventDayLocal(end, eventDateKey);
  if (!endL) return false;
  return now.getTime() <= endL.getTime();
}

/**
 * Returns sessions happening now (on today) and the next 2 upcoming sessions (any day).
 * Uses the same calendar-day rule as the Agenda tab: `getSessionDateKeyFromIso(start_time)` vs event day keys,
 * not raw `day_number` (which can disagree with timestamps and caused "Lunch" on Info but not on Agenda).
 */
export function getNowNextSessions(
  sessions: SessionForNowNext[],
  eventStartDate: string | null | undefined,
  eventEndDate?: string | null | undefined
): { nowSessions: SessionForNowNext[]; nextSessions: SessionForNowNext[] } {
  if (!eventStartDate || sessions.length === 0) return { nowSessions: [], nextSessions: [] };
  const now = new Date();
  const todayKey = getDeviceLocalDateKey(now);

  let dayNums = getEventDayNumbers(eventStartDate, eventEndDate ?? null);
  if (dayNums.length === 0) {
    dayNums = [...new Set(sessions.map((s) => Number(s.day_number)).filter((n) => !Number.isNaN(n) && n >= 1))].sort(
      (a, b) => a - b
    );
  }
  const todayNum = dayNums.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey) ?? null;

  const nowList: SessionForNowNext[] = [];
  if (todayNum != null && todayKey) {
    const sessionsOnTodayTab = sessions.filter((s) => getSessionDateKeyFromIso(s.start_time) === todayKey);
    for (const s of sessionsOnTodayTab) {
      const start = parseSessionDate(s.start_time);
      const end = parseSessionDate(s.end_time);
      if (!start || !end) continue;
      if (isSessionLiveWallClockOnEventDay(now, start, end, todayKey)) {
        nowList.push(s);
      }
    }
  }

  const nextList: SessionForNowNext[] = [];
  const nowMs = now.getTime();
  for (const s of sessions) {
    const start = parseSessionDate(s.start_time);
    if (!start) continue;
    const dateKey = getSessionDateKeyFromIso(s.start_time);
    if (!dateKey) continue;
    const startLocal = sessionInstantOnEventDayLocal(start, dateKey);
    if (!startLocal) continue;
    if (startLocal.getTime() > nowMs) {
      nextList.push(s);
    }
  }
  nextList.sort((a, b) => {
    const daK = getSessionDateKeyFromIso(a.start_time) ?? '';
    const dbK = getSessionDateKeyFromIso(b.start_time) ?? '';
    const sa = parseSessionDate(a.start_time);
    const sb = parseSessionDate(b.start_time);
    const ta = sa ? sessionInstantOnEventDayLocal(sa, daK)?.getTime() ?? 0 : 0;
    const tb = sb ? sessionInstantOnEventDayLocal(sb, dbK)?.getTime() ?? 0 : 0;
    return ta - tb;
  });
  return { nowSessions: nowList, nextSessions: nextList.slice(0, 2) };
}

/**
 * Display time using UTC clock components so it matches Agenda (`schedule.tsx` formatTime)
 * when sessions are stored as UTC instants (wall-clock aligned with admin).
 */
export function formatSessionTime(iso: string): string {
  const d = parseSessionDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * B2B meeting_slots store real instants. Show time in the user's local timezone.
 * (Agenda schedule rows use formatSessionTime = UTC components for schedule_sessions only.)
 */
export function formatB2BSlotTimeLocal(iso: string): string {
  const d = parseSessionDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** One line for admin session cards: matches Agenda tab wall-clock (UTC field) display. */
export function formatSessionWallClockAdminRange(startIso: string, endIso: string): string {
  const d1 = parseSessionDate(startIso);
  if (!d1 || Number.isNaN(d1.getTime())) return '—';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const head = `${days[d1.getUTCDay()]}, ${mons[d1.getUTCMonth()]} ${d1.getUTCDate()} · ${formatSessionTime(startIso)}`;
  return `${head} – ${formatSessionTime(endIso)}`;
}
