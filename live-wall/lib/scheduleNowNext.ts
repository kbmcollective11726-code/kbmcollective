import { parseISO } from 'date-fns';
import { DateTime } from 'luxon';

export interface SessionForNowNext {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  day_number: number;
  [key: string]: unknown;
}

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

function getDateKeyForDayNumber(dayNumber: number, eventStartDate: string | null | undefined): string | null {
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
  return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(
    sessionDate.getDate()
  ).padStart(2, '0')}`;
}

function getDeviceLocalDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSessionDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = parseSessionDate(iso);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(
    2,
    '0'
  )}`;
}

function getEventDayNumbers(startDate: string | null | undefined, endDate: string | null | undefined): number[] {
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') return [];
  const start = parseISO(startDate.trim().split(/\s/)[0] ?? '');
  const end = parseISO(endDate.trim().split(/\s/)[0] ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  if (endMs < startMs) return [];
  const days = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: Math.max(1, Math.min(days, 365)) }, (_, i) => i + 1);
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
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  const hour = timeField.getUTCHours();
  const minute = timeField.getUTCMinutes();
  const zone = (eventIanaZone ?? '').trim();
  if (zone) {
    const dt = DateTime.fromObject(
      { year: y, month: mo, day: d, hour, minute, second: 0, millisecond: 0 },
      { zone },
    );
    if (!dt.isValid) return null;
    return dt.toJSDate();
  }
  return new Date(y, mo - 1, d, hour, minute, 0, 0);
}

function isSessionLiveWallClockOnEventDay(
  now: Date,
  start: Date,
  end: Date,
  eventDateKey: string,
  eventIanaZone?: string | null
): boolean {
  const startL = sessionInstantOnEventDayLocal(start, eventDateKey, eventIanaZone);
  const endL = sessionInstantOnEventDayLocal(end, eventDateKey, eventIanaZone);
  if (!startL || !endL) return false;
  const t = now.getTime();
  if (endL.getTime() >= startL.getTime()) return t >= startL.getTime() && t <= endL.getTime();
  return t >= startL.getTime() || t <= endL.getTime();
}

export function getNowNextSessions(
  sessions: SessionForNowNext[],
  eventStartDate: string | null | undefined,
  eventEndDate?: string | null | undefined,
  eventReminderTimezone?: string | null
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
      if (isSessionLiveWallClockOnEventDay(now, start, end, todayKey, eventReminderTimezone)) nowList.push(s);
    }
  }

  const nextList: SessionForNowNext[] = [];
  const nowMs = now.getTime();
  for (const s of sessions) {
    const start = parseSessionDate(s.start_time);
    const dateKey = getSessionDateKeyFromIso(s.start_time);
    if (!start || !dateKey) continue;
    const startLocal = sessionInstantOnEventDayLocal(start, dateKey, eventReminderTimezone);
    if (!startLocal) continue;
    if (startLocal.getTime() > nowMs) nextList.push(s);
  }

  nextList.sort((a, b) => {
    const daK = getSessionDateKeyFromIso(a.start_time) ?? '';
    const dbK = getSessionDateKeyFromIso(b.start_time) ?? '';
    const sa = parseSessionDate(a.start_time);
    const sb = parseSessionDate(b.start_time);
    const ta = sa ? sessionInstantOnEventDayLocal(sa, daK, eventReminderTimezone)?.getTime() ?? 0 : 0;
    const tb = sb ? sessionInstantOnEventDayLocal(sb, dbK, eventReminderTimezone)?.getTime() ?? 0 : 0;
    return ta - tb;
  });

  return { nowSessions: nowList, nextSessions: nextList.slice(0, 2) };
}

export function formatSessionTime(iso: string): string {
  const d = parseSessionDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

