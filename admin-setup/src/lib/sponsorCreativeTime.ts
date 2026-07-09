import {
  addMinutesToDatetimeLocalWallClock,
  datetimeLocalToUtcIsoWallClock,
  formatB2BWhenLabelWallClock,
  utcIsoToDatetimeLocalWallClock,
} from './b2bEventTime';

export function listEventDayKeys(startDate: string, endDate: string): string[] {
  const startMatch = String(startDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endMatch = String(endDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!startMatch || !endMatch) return [];
  const sy = parseInt(startMatch[1]!, 10);
  const sm = parseInt(startMatch[2]!, 10);
  const sd = parseInt(startMatch[3]!, 10);
  const ey = parseInt(endMatch[1]!, 10);
  const em = parseInt(endMatch[2]!, 10);
  const ed = parseInt(endMatch[3]!, 10);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const keys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

export function allDayDatetimeLocalRange(dayKey: string): { startLocal: string; endLocal: string } {
  return { startLocal: `${dayKey}T00:00`, endLocal: `${dayKey}T23:59` };
}

export function formatCreativeWindowLabel(startsAt: string, endsAt: string): string {
  const startLabel = formatB2BWhenLabelWallClock(startsAt);
  const endLabel = formatB2BWhenLabelWallClock(endsAt);
  if (!startLabel || !endLabel) return '—';
  return `${startLabel} → ${endLabel}`;
}

export {
  addMinutesToDatetimeLocalWallClock,
  datetimeLocalToUtcIsoWallClock,
  utcIsoToDatetimeLocalWallClock,
};
