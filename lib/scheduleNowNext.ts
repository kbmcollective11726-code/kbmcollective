import { format, parseISO } from 'date-fns';

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

export interface SessionForNowNext {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  day_number: number;
  [key: string]: unknown;
}

/**
 * Returns sessions happening now (on today) and the next 2 upcoming sessions (any day).
 * Uses start_time/end_time as full timestamps so timezone is correct when DB sends UTC (e.g. with Z).
 */
export function getNowNextSessions(
  sessions: SessionForNowNext[],
  eventStartDate: string | null | undefined
): { nowSessions: SessionForNowNext[]; nextSessions: SessionForNowNext[] } {
  if (!eventStartDate || sessions.length === 0) return { nowSessions: [], nextSessions: [] };
  const now = new Date();
  const nowMs = now.getTime();
  const todayKey = format(now, 'yyyy-MM-dd');
  const dayNumbers = [...new Set(sessions.map((s) => Number(s.day_number)).filter((n) => !Number.isNaN(n) && n >= 1))].sort((a, b) => a - b);
  const todayNum = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey) ?? null;

  const nowList: SessionForNowNext[] = [];
  if (todayNum != null) {
    const todaySessions = sessions.filter((s) => Number(s.day_number) === todayNum);
    for (const s of todaySessions) {
      const start = parseSessionDate(s.start_time);
      const end = parseSessionDate(s.end_time);
      if (!start || !end) continue;
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (nowMs >= startMs && nowMs <= endMs) {
        nowList.push(s);
      }
    }
  }

  const nextList: SessionForNowNext[] = [];
  for (const s of sessions) {
    const start = parseSessionDate(s.start_time);
    if (!start) continue;
    if (start.getTime() > nowMs) {
      nextList.push(s);
    }
  }
  nextList.sort((a, b) => {
    const ta = parseSessionDate(a.start_time)?.getTime() ?? 0;
    const tb = parseSessionDate(b.start_time)?.getTime() ?? 0;
    return ta - tb;
  });
  return { nowSessions: nowList, nextSessions: nextList.slice(0, 2) };
}

export function formatSessionTime(iso: string): string {
  const d = parseSessionDate(iso);
  return d ? format(d, 'h:mm a') : '—';
}
