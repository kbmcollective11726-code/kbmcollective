import type { ScheduleSession, SpeakerEntry } from './types';

/** UTC calendar yyyy-MM-dd from stored timestamp (matches app `schedule.tsx` getSessionDateKey). */
export function getSessionDateKeyFromIso(iso: string | null | undefined): string | null {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Agenda tab date for day N — local calendar from event start_date (matches app getDateKeyForDayNumber).
 */
export function getDateKeyForDayNumber(dayNumber: number, eventStartDate: string | null | undefined): string | null {
  if (!eventStartDate || typeof eventStartDate !== 'string' || dayNumber == null) return null;
  const match = String(eventStartDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1] ?? '0', 10);
  const month = parseInt(match[2] ?? '0', 10);
  const day = parseInt(match[3] ?? '0', 10);
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

/** Event day indices 1..N from start_date through end_date inclusive (matches app getEventDayNumbers). */
export function getEventDayNumbers(startDate: string | null | undefined, endDate: string | null | undefined): number[] {
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') return [];
  const startStr = startDate.trim().split(/\s/)[0] ?? '';
  const endStr = endDate.trim().split(/\s/)[0] ?? '';
  const parseLocal = (s: string) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = parseInt(m[1] ?? '0', 10);
    const mo = parseInt(m[2] ?? '0', 10);
    const d = parseInt(m[3] ?? '0', 10);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };
  const start = parseLocal(startStr);
  const end = parseLocal(endStr);
  if (!start || !end) return [];
  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  if (endMs < startMs) return [];
  const days = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: Math.max(1, Math.min(days, 365)) }, (_, i) => i + 1);
}

export function formatDateKeyForDisplay(dateKey: string): string {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const y = parseInt(m[1] ?? '0', 10);
  const mo = parseInt(m[2] ?? '0', 10);
  const d = parseInt(m[3] ?? '0', 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return dateKey;
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatTime12FromISO(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export function formatSessionSpeakersLine(s: ScheduleSession): string {
  const arr = Array.isArray(s.speakers) ? s.speakers : [];
  const names = arr
    .map((x) => (x && typeof x === 'object' ? String((x as SpeakerEntry).name ?? '').trim() : ''))
    .filter(Boolean);
  if (names.length > 0) return names.join(', ');
  return s.speaker_name?.trim() ? s.speaker_name.trim() : '';
}

export type AgendaDayRow = {
  dayNum: number | null;
  dateLabel: string;
  dateKey: string;
  items: ScheduleSession[];
};

/**
 * Same bucketing as mobile Agenda and admin Schedule list.
 */
export function buildAgendaDayRows(
  sessions: ScheduleSession[],
  eventStart: string | null | undefined,
  eventEnd: string | null | undefined
): AgendaDayRow[] {
  let dayNums = getEventDayNumbers(eventStart, eventEnd);
  if (dayNums.length === 0 && sessions.length > 0) {
    const set = new Set<number>();
    for (const s of sessions) {
      const n = Number(s.day_number);
      if (Number.isFinite(n) && n >= 1) set.add(n);
    }
    dayNums = Array.from(set).sort((a, b) => a - b);
    if (dayNums.length === 0) dayNums = [1];
  }

  const rows: AgendaDayRow[] = [];
  const assigned = new Set<string>();

  if (dayNums.length > 0 && eventStart) {
    for (const dayNum of dayNums) {
      const dateKey = getDateKeyForDayNumber(dayNum, eventStart);
      if (!dateKey) continue;
      const items = sessions
        .filter((s) => getSessionDateKeyFromIso(s.start_time) === dateKey)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (const s of items) assigned.add(s.id);
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
    const byKey = new Map<string, ScheduleSession[]>();
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
