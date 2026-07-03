import { format, parseISO } from 'date-fns';
import {
  formatDateKeyForDisplay,
  getDateKeyForDayNumber,
  getEventDayNumbers,
  getSessionDateKeyFromIso,
  isSessionLiveWallClockOnEventDay,
  parseSessionDate,
  sessionInstantOnEventDayLocal,
  sessionMatchesAgendaDay,
} from './scheduleNowNext';
import type { SessionCheckInListItem } from './sessionCheckInRpc';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day strip: full event range first (same as Agenda tab), else session day_number values. */
export function getSessionDayNumbers(
  sessions: SessionCheckInListItem[],
  eventStartDate: string | null | undefined,
  eventEndDate: string | null | undefined
): number[] {
  const fromRange = getEventDayNumbers(eventStartDate, eventEndDate);
  if (fromRange.length > 0) return fromRange;
  const fromSessions = new Set<number>();
  for (const s of sessions) {
    const n = Number(s.day_number);
    if (!Number.isNaN(n) && n >= 1) fromSessions.add(n);
  }
  return Array.from(fromSessions).sort((a, b) => a - b);
}

/** Default day chip: today (event calendar), else day of live/next session, else first day. */
export function pickDefaultDayNumber(
  sessions: SessionCheckInListItem[],
  eventStartDate: string | null | undefined,
  eventEndDate: string | null | undefined,
  todayDateKey: string
): number | null {
  const dayNumbers = getSessionDayNumbers(sessions, eventStartDate, eventEndDate);
  if (dayNumbers.length === 0) return null;

  if (eventStartDate) {
    const todayDay = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayDateKey);
    if (todayDay != null) return todayDay;
  }

  const todayDayForFocus = eventStartDate
    ? dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayDateKey)
    : null;
  const focusDateKey =
    todayDayForFocus != null && eventStartDate
      ? getDateKeyForDayNumber(todayDayForFocus, eventStartDate)
      : null;
  const focusId = pickFocusSessionId(sessions, focusDateKey);
  if (focusId && eventStartDate) {
    const row = sessions.find((s) => s.id === focusId);
    if (row) {
      const dk = getSessionDateKeyFromIso(row.start_time);
      if (dk) {
        const matchDay = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === dk);
        if (matchDay != null) return matchDay;
      }
      const dn = Number(row.day_number);
      if (!Number.isNaN(dn) && dn >= 1 && dayNumbers.includes(dn)) return dn;
    }
  }

  return dayNumbers[0];
}

/** Live now, else next upcoming — wall-clock on event day (same as Agenda). */
export function pickFocusSessionId(
  sessions: SessionCheckInListItem[],
  eventDateKey: string | null,
  eventReminderTimezone?: string | null
): string | null {
  if (sessions.length === 0) return null;
  const now = new Date();
  const nowMs = now.getTime();
  let live: SessionCheckInListItem | null = null;
  let liveStart = Number.NEGATIVE_INFINITY;
  let next: SessionCheckInListItem | null = null;
  let nextStart = Infinity;

  for (const s of sessions) {
    const start = parseSessionDate(s.start_time);
    const end = parseSessionDate(s.end_time);
    if (!start || !end) continue;
    const startMs = eventDateKey
      ? sessionInstantOnEventDayLocal(start, eventDateKey, eventReminderTimezone)?.getTime()
      : start.getTime();
    const endMs = eventDateKey
      ? sessionInstantOnEventDayLocal(end, eventDateKey, eventReminderTimezone)?.getTime()
      : end?.getTime() ?? start.getTime();
    if (startMs == null || endMs == null) continue;

    if (eventDateKey && isSessionLiveWallClockOnEventDay(now, start, end, eventDateKey, eventReminderTimezone)) {
      if (startMs > liveStart) {
        liveStart = startMs;
        live = s;
      }
      continue;
    }
    if (!eventDateKey && nowMs >= startMs && nowMs <= endMs) {
      if (startMs > liveStart) {
        liveStart = startMs;
        live = s;
      }
      continue;
    }
    if (startMs > nowMs && startMs < nextStart) {
      next = s;
      nextStart = startMs;
    }
  }

  return (live ?? next ?? sessions[0])?.id ?? null;
}

/** Same filter as Agenda tab (date key + day_number tag). */
export function sessionBelongsToEventDay(
  s: SessionCheckInListItem,
  dayNumber: number,
  eventStartDate: string | null | undefined
): boolean {
  return sessionMatchesAgendaDay(s, dayNumber, eventStartDate);
}

export function filterSessionsForPicker(
  sessions: SessionCheckInListItem[],
  dayNumber: number | null,
  query: string,
  eventStartDate: string | null | undefined,
  eventReminderTimezone?: string | null
): SessionCheckInListItem[] {
  const q = query.trim().toLowerCase();
  const selectedDateKey =
    dayNumber != null && eventStartDate ? getDateKeyForDayNumber(dayNumber, eventStartDate) : null;
  const filtered = sessions.filter((s) => {
    if (dayNumber != null && !sessionBelongsToEventDay(s, dayNumber, eventStartDate)) return false;
    if (!q) return true;
    return (
      s.title?.toLowerCase().includes(q) ||
      s.room?.toLowerCase().includes(q) ||
      s.location?.toLowerCase().includes(q)
    );
  });
  return filtered.sort((a, b) => {
    if (!selectedDateKey) {
      const ta = parseSessionDate(a.start_time)?.getTime() ?? 0;
      const tb = parseSessionDate(b.start_time)?.getTime() ?? 0;
      return ta - tb;
    }
    const sa = parseSessionDate(a.start_time);
    const sb = parseSessionDate(b.start_time);
    const ta = sa ? sessionInstantOnEventDayLocal(sa, selectedDateKey, eventReminderTimezone)?.getTime() ?? 0 : 0;
    const tb = sb ? sessionInstantOnEventDayLocal(sb, selectedDateKey, eventReminderTimezone)?.getTime() ?? 0 : 0;
    return ta - tb;
  });
}

/** Short chip label e.g. "Mon, May 4" (matches session row dates). */
export function getDayChipShortLabel(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string {
  const key = eventStartDate ? getDateKeyForDayNumber(dayNumber, eventStartDate) : null;
  if (!key) return `Day ${dayNumber}`;
  const d = parseISO(key);
  if (Number.isNaN(d.getTime())) return `Day ${dayNumber}`;
  return format(d, 'EEE, MMM d');
}

/** Full label for accessibility. */
export function getDayChipDisplay(
  dayNumber: number,
  eventStartDate: string | null | undefined
): { dayOfMonth: number; weekday: string; fullLabel: string; shortLabel: string } | null {
  const key = eventStartDate ? getDateKeyForDayNumber(dayNumber, eventStartDate) : null;
  if (!key) {
    const fallback = `Day ${dayNumber}`;
    return { dayOfMonth: dayNumber, weekday: `DAY ${dayNumber}`, fullLabel: fallback, shortLabel: fallback };
  }
  const d = parseISO(key);
  if (Number.isNaN(d.getTime())) {
    const fallback = `Day ${dayNumber}`;
    return { dayOfMonth: dayNumber, weekday: `DAY ${dayNumber}`, fullLabel: fallback, shortLabel: fallback };
  }
  const fullLabel = formatDateKeyForDisplay(key);
  return {
    dayOfMonth: d.getDate(),
    weekday: (DAY_NAMES[d.getDay()] ?? 'Day').toUpperCase(),
    fullLabel,
    shortLabel: format(d, 'EEE, MMM d'),
  };
}

/** e.g. "April 2026" above day strip (Agenda header). */
export function formatMonthYearForDay(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string | null {
  const key = eventStartDate ? getDateKeyForDayNumber(dayNumber, eventStartDate) : null;
  if (!key) return null;
  const d = parseISO(key);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 'MMMM yyyy');
}

/** @deprecated Use getDayChipDisplay — kept for tests */
export function formatDayChipLabel(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string {
  return getDayChipDisplay(dayNumber, eventStartDate)?.fullLabel ?? `Day ${dayNumber}`;
}

export function isSessionLiveNow(
  s: SessionCheckInListItem,
  eventDateKey: string | null,
  eventReminderTimezone?: string | null,
  now: Date = new Date()
): boolean {
  const start = parseSessionDate(s.start_time);
  const end = parseSessionDate(s.end_time);
  if (!start || !end || !eventDateKey) return false;
  return isSessionLiveWallClockOnEventDay(now, start, end, eventDateKey, eventReminderTimezone);
}
