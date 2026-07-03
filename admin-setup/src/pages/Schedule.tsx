import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import {
  buildAgendaDayRows,
  formatSessionSpeakersLine,
  formatTime12FromISO,
  getDateKeyForDayNumber,
  getEventDayNumbers,
  getSessionDateKeyFromIso,
} from '../lib/agendaDayRows';
import type { Event, ScheduleSession, SpeakerEntry } from '../lib/types';
import { isEventNotificationsPausedActive } from '../lib/eventNotificationsPaused';
import { notifyScheduleChange, formatScheduleNotifyResult } from '../lib/scheduleChangeNotificationPush';
import styles from './Schedule.module.css';

/** Up to 5 speakers per session (matches mobile `speakers` JSON + denormalized first speaker). */
const CSV_HEADERS = [
  'title',
  'description',
  'speaker_name',
  'speaker_title',
  'speaker_company',
  'speaker_2_name',
  'speaker_2_title',
  'speaker_2_company',
  'speaker_3_name',
  'speaker_3_title',
  'speaker_3_company',
  'speaker_4_name',
  'speaker_4_title',
  'speaker_4_company',
  'speaker_5_name',
  'speaker_5_title',
  'speaker_5_company',
  'location',
  'room',
  'start_date',
  'start_time',
  'end_date',
  'end_time',
  'session_type',
] as const;
type CsvHeader = (typeof CSV_HEADERS)[number];
const SESSION_TYPES = ['keynote', 'breakout', 'workshop', 'social', 'meal', 'networking', 'vendor'] as const;

function normalizeSessionTypeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeSessionTypesList(raw: string | null | undefined): string[] {
  const tokens = String(raw ?? '')
    .split(',')
    .map((t) => normalizeSessionTypeToken(t))
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

function serializeSessionTypes(list: string[]): string {
  const normalized = Array.from(new Set(list.map((t) => normalizeSessionTypeToken(t)).filter(Boolean)));
  return normalized.length > 0 ? normalized.join(',') : 'breakout';
}

function normalizeSessionDescription(raw: string): string {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  const normalizedBullets = text.replace(/[•●▪◦‣⁃]/g, ' - ');
  const withLineBullets = normalizedBullets.replace(/\s-\s+/g, '\n- ');
  return withLineBullets.replace(/\n{3,}/g, '\n\n').trim();
}

/** Map a CSV header cell to our canonical column (handles Excel export names). */
function mapHeaderToCanonical(raw: string): CsvHeader | null {
  const n = raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if ((CSV_HEADERS as readonly string[]).includes(n)) return n as CsvHeader;
  const aliases: Record<string, CsvHeader> = {
    session_title: 'title',
    session_name: 'title',
    talk_title: 'title',
    speaker: 'speaker_name',
    speakername: 'speaker_name',
    name_speaker: 'speaker_name',
    session_speaker: 'speaker_name',
    job_title: 'speaker_title',
    role: 'speaker_title',
    company: 'speaker_company',
    org: 'speaker_company',
    organization: 'speaker_company',
    venue: 'location',
    hall: 'location',
    building: 'location',
    room_name: 'room',
    space: 'room',
    breakout_room: 'room',
    date: 'start_date',
    session_date: 'start_date',
    day_date: 'start_date',
    startdate: 'start_date',
    enddate: 'end_date',
    time_start: 'start_time',
    starttime: 'start_time',
    begin_time: 'start_time',
    time_end: 'end_time',
    endtime: 'end_time',
    finish_time: 'end_time',
    type: 'session_type',
    sessiontype: 'session_type',
    category: 'session_type',
    track: 'session_type',
    speaker2: 'speaker_2_name',
    speaker_2: 'speaker_2_name',
    cospeaker: 'speaker_2_name',
    co_speaker: 'speaker_2_name',
    speaker2name: 'speaker_2_name',
    speaker2title: 'speaker_2_title',
    speaker2company: 'speaker_2_company',
    speaker3: 'speaker_3_name',
    speaker3_name: 'speaker_3_name',
    speaker3name: 'speaker_3_name',
    speaker3_title: 'speaker_3_title',
    speaker3title: 'speaker_3_title',
    speaker3_company: 'speaker_3_company',
    speaker3company: 'speaker_3_company',
    speaker4: 'speaker_4_name',
    speaker4_name: 'speaker_4_name',
    speaker4name: 'speaker_4_name',
    speaker4_title: 'speaker_4_title',
    speaker4title: 'speaker_4_title',
    speaker4_company: 'speaker_4_company',
    speaker4company: 'speaker_4_company',
    speaker5: 'speaker_5_name',
    speaker5_name: 'speaker_5_name',
    speaker5name: 'speaker_5_name',
    speaker5_title: 'speaker_5_title',
    speaker5title: 'speaker_5_title',
    speaker5_company: 'speaker_5_company',
    speaker5company: 'speaker_5_company',
  };
  return aliases[n] ?? null;
}

type SpeakerFormRow = { key: string; name: string; title: string; company: string };

function newSpeakerRow(): SpeakerFormRow {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sp-${Date.now()}-${Math.random()}`,
    name: '',
    title: '',
    company: '',
  };
}

function sessionToSpeakerRows(s: ScheduleSession): SpeakerFormRow[] {
  const arr = Array.isArray(s.speakers) ? s.speakers : [];
  const out: SpeakerFormRow[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const name = String((x as SpeakerEntry).name ?? '').trim();
    if (!name) continue;
    out.push({
      key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sp-${out.length}`,
      name,
      title: String((x as SpeakerEntry).title ?? '').trim(),
      company: String((x as SpeakerEntry).company ?? '').trim(),
    });
  }
  if (out.length === 0 && s.speaker_name?.trim()) {
    out.push({
      key: 'legacy',
      name: s.speaker_name.trim(),
      title: (s.speaker_title ?? '').trim(),
      company: '',
    });
  }
  if (out.length === 0) out.push(newSpeakerRow());
  return out;
}

function speakersToDbPayload(rows: SpeakerFormRow[]) {
  const filtered = rows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), title: r.title.trim() || '', company: r.company.trim() || null }));
  const first = filtered[0];
  return {
    speakers: filtered.length > 0 ? filtered : null,
    speaker_name: first?.name ?? null,
    speaker_title: first?.title ?? null,
  };
}

function speakersPayloadFromCsvRow(row: Record<string, string>) {
  const slots = [
    { name: row.speaker_name ?? '', title: row.speaker_title ?? '', company: row.speaker_company ?? '' },
    ...[2, 3, 4, 5].map((i) => ({
      name: row[`speaker_${i}_name`] ?? '',
      title: row[`speaker_${i}_title`] ?? '',
      company: row[`speaker_${i}_company`] ?? '',
    })),
  ];
  const filtered = slots
    .map((s) => ({
      name: String(s.name).trim(),
      title: String(s.title).trim(),
      company: String(s.company).trim(),
    }))
    .filter((s) => s.name);
  const mapped = filtered.map((s) => ({ name: s.name, title: s.title, company: s.company || null }));
  const first = mapped[0];
  return {
    speakers: mapped.length > 0 ? mapped : null,
    speaker_name: first?.name ?? null,
    speaker_title: first?.title ?? null,
  };
}

type SessionFormState = {
  title: string;
  description: string;
  speakers: SpeakerFormRow[];
  location: string;
  room: string;
  start_time: string;
  end_time: string;
  session_types: string[];
  /** Star rating + feedback in the app (per session) */
  ratings_enabled: boolean;
  /** Room check-in in the mobile Session check-in list */
  check_in_enabled: boolean;
};

/**
 * If the first row looks like real headers, return canonical column → index.
 * Otherwise null → use fixed column order (legacy; first row still skipped).
 */
function buildColumnMapFromHeaderRow(headerCells: string[]): Map<CsvHeader, number> | null {
  const map = new Map<CsvHeader, number>();
  headerCells.forEach((cell, idx) => {
    const c = mapHeaderToCanonical(cell);
    if (c != null && !map.has(c)) map.set(c, idx);
  });
  const hasTitle = map.has('title');
  const hasStartWhen = map.has('start_time') || map.has('start_date');
  if (hasTitle && hasStartWhen && map.size >= 3) return map;
  return null;
}

/**
 * Pre–speaker_3 CSV layout (15 columns): two speakers only, then location → session_type.
 * If this file is parsed as 24-wide positional, dates land under speaker_3_* and break import.
 */
const LEGACY_15_ORDER: CsvHeader[] = [
  'title',
  'description',
  'speaker_name',
  'speaker_title',
  'speaker_company',
  'speaker_2_name',
  'speaker_2_title',
  'speaker_2_company',
  'location',
  'room',
  'start_date',
  'start_time',
  'end_date',
  'end_time',
  'session_type',
];

function valuesToRowLegacy15(values: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  CSV_HEADERS.forEach((h) => {
    row[h] = '';
  });
  LEGACY_15_ORDER.forEach((h, i) => {
    row[h] = (values[i] ?? '').trim();
  });
  return row;
}

/** When start_date looks like a time and start_time like a date, swap (common Excel export mix-ups). */
function normalizeDateTimePair(
  dateStr: string,
  timeStr: string
): { dateStr: string; timeStr: string } {
  const dOk = parseDateToYMD(dateStr);
  const tOk = parseTimeToHHMMLoose(timeStr);
  if (dOk && tOk) return { dateStr, timeStr };
  const dSwap = parseDateToYMD(timeStr);
  const rawDate = (dateStr ?? '').trim();
  // Bare 1–4 digit "times" are usually room numbers (e.g. 202), not HH:mm — do not swap.
  const tSwap =
    parseTimeToHHMMLoose(dateStr) != null && !/^\d{1,4}$/.test(rawDate);
  if (dSwap && tSwap) return { dateStr: timeStr, timeStr: dateStr };
  return { dateStr, timeStr };
}

/**
 * Fix Excel quirks: "202 2026-03-28" in start_date, or room in start_date + ISO date in start_time (column shift).
 * Mutates row for room if we steal a leading room token.
 */
function sanitizeScheduleRowDateCells(row: Record<string, string>): void {
  let sd = (row.start_date || '').trim();
  let st = (row.start_time || '').trim();

  const isoThenTime = st.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (isoThenTime) {
    const dPart = isoThenTime[1] ?? '';
    const tPart = isoThenTime[2] ?? '';
    row.start_date = dPart;
    row.start_time = tPart;
    sd = dPart;
    st = tPart;
  }

  const roomThenDate = sd.match(/^(\d{1,4})\s+(\d{4}-\d{1,2}-\d{1,2})$/);
  if (roomThenDate) {
    const roomPart = roomThenDate[1] ?? '';
    const datePart = roomThenDate[2] ?? '';
    if (!(row.room || '').trim()) row.room = roomPart;
    sd = datePart;
    row.start_date = sd;
  }

  // Room-only in date cell + ISO date in time cell (e.g. start_date "301", start_time "2026-03-28")
  if (/^\d{1,4}$/.test(sd) && parseDateToYMD(st)) {
    if (!(row.room || '').trim()) row.room = sd;
    row.start_date = st;
    row.start_time = '';
  }
}

function parseDateToYMD(dateStr: string): { y: number; m: number; d: number } | null {
  const s = (dateStr ?? '').toString().trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = parseInt(iso[1] ?? '0', 10);
    const m = parseInt(iso[2] ?? '0', 10);
    const d = parseInt(iso[3] ?? '0', 10);
    if (!y || !m || !d) return null;
    return { y, m, d };
  }

  // US/Local formats: MM/DD/YYYY or DD/MM/YYYY
  if (s.includes('/')) {
    const parts = s.split('/').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      const a = parts[0];
      const b = parts[1];
      const c = parts[2];
      if (
        typeof a === 'number' &&
        typeof b === 'number' &&
        typeof c === 'number' &&
        Number.isFinite(a) && a > 0 &&
        Number.isFinite(b) && b > 0 &&
        Number.isFinite(c) && c >= 1000
      ) {
        // Heuristic: if first part > 12 then it's likely DD/MM/YYYY
        const y = c;
        if (a > 12) return { y, m: b, d: a };
        return { y, m: a, d: b };
      }
    }
  }

  // Excel serial date (days since 1899-12-30). Also handle decimals (time fraction ignored here).
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 2000) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.floor(serial) * 86400000);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    if (!y || !m || !d) return null;
    return { y, m, d };
  }

  // Trailing date only (e.g. merged cell "Grand Ballroom 2026-03-25")
  const isoEnd = s.match(/(\d{4}-\d{1,2}-\d{1,2})\s*$/);
  if (isoEnd?.[1]) {
    const ymd = parseDateToYMD(isoEnd[1]);
    if (ymd) return ymd;
  }
  const slashEnd = s.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
  if (slashEnd?.[1]) {
    const ymd = parseDateToYMD(slashEnd[1]);
    if (ymd) return ymd;
  }

  return null;
}

function parseTimeToHHMM(timeStr: string): { h: number; m: number } | null {
  const s = (timeStr ?? '').toString().trim();
  if (!s) return null;

  // Excel time fraction: e.g. 0.375
  const asNumber = Number(s);
  if (Number.isFinite(asNumber) && asNumber > 0 && asNumber < 1) {
    const totalMinutes = Math.round(asNumber * 24 * 60);
    return { h: Math.floor(totalMinutes / 60) % 24, m: totalMinutes % 60 };
  }

  // HH:mm, H:mm, optionally with AM/PM and optional seconds
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1] ?? '0', 10);
  const mm = parseInt(m[2] ?? '0', 10);
  const ampm = (m[4] ?? '').toUpperCase();
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  h = Math.max(0, Math.min(23, h));
  let mins = Math.max(0, Math.min(59, mm));

  if (ampm) {
    // "12:xx AM" -> 0:xx, "12:xx PM" -> 12:xx
    if (ampm === 'AM') {
      h = h === 12 ? 0 : h;
    } else if (ampm === 'PM') {
      h = h === 12 ? 12 : h + 12;
    }
  }

  return { h, m: mins };
}

function parseTimeToHHMMLoose(timeStr: string): { h: number; m: number } | null {
  const s = (timeStr ?? '').toString().trim();
  if (!s) return null;
  const direct = parseTimeToHHMM(s);
  if (direct) return direct;
  const lead = s.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (lead?.[1]) {
    const inner = parseTimeToHHMM(lead[1]);
    if (inner) return inner;
  }
  const afterIso = s.match(/^\d{4}-\d{1,2}-\d{1,2}\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (afterIso?.[1]) {
    const inner = parseTimeToHHMM(afterIso[1]);
    if (inner) return inner;
  }
  return null;
}

/** DB day_number for a session start — same rule as mobile agenda filter. */
function getAgendaDayNumberFromStartIso(
  iso: string,
  eventStart: string,
  eventEnd: string | null | undefined
): number {
  const sk = getSessionDateKeyFromIso(iso);
  if (!sk) return 1;
  const dayNums = getEventDayNumbers(eventStart, eventEnd);
  for (const dayNum of dayNums) {
    if (getDateKeyForDayNumber(dayNum, eventStart) === sk) return dayNum;
  }
  if (dayNums.length === 0) {
    const startKey = eventStart.slice(0, 10);
    if (startKey.length >= 10) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return getDayNumberUtcOffset(d, eventStart);
    }
    return 1;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 1 : getDayNumberUtcOffset(d, eventStart);
}

function getAgendaDayNumberForTimestamp(
  iso: string,
  eventStart: string | null | undefined,
  eventEnd: string | null | undefined,
  fallbackDay: number
): number {
  if (!eventStart || eventStart.length < 10) {
    const n = Math.floor(Number(fallbackDay));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }
  return getAgendaDayNumberFromStartIso(iso, eventStart, eventEnd ?? undefined);
}

/** Fallback when session is outside event date range: UTC-midnight offset from event start (legacy). */
function getDayNumberUtcOffset(startTime: Date, eventStartDate: string): number {
  const startKey = eventStartDate.slice(0, 10);
  if (!startKey || startKey.length < 10) return 1;
  const [ys, ms, ds] = startKey.split('-');
  const sy = parseInt(ys ?? '0', 10) || 0;
  const sm = parseInt(ms ?? '1', 10) || 1;
  const sd = parseInt(ds ?? '1', 10) || 1;
  const start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0));
  const diffMs = startTime.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays + 1);
}

function parseYMDUTC(dateStr: string): { y: number; m: number; d: number } | null {
  const key = dateStr.trim().slice(0, 10);
  const [ys, ms, ds] = key.split('-');
  const y = parseInt(ys ?? '', 10);
  const m = parseInt(ms ?? '', 10);
  const d = parseInt(ds ?? '', 10);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function addDaysUTC(ymd: { y: number; m: number; d: number }, days: number): Date {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days, 0, 0, 0, 0));
}

function toDateTimeLocalFromEventDayAndISO(
  iso: string,
  dayNumber: number,
  eventStartDate: string | null | undefined
): string {
  if (!eventStartDate) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ymd = parseYMDUTC(eventStartDate);
  if (!ymd) return '';
  const date = addDaysUTC(ymd, Math.max(0, dayNumber - 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${min}`;
}

export default function Schedule() {
  const { eventId } = useParams<{ eventId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; failed: number; errors: string[] } | null>(null);
  const [editingSession, setEditingSession] = useState<ScheduleSession | null>(null);
  const [editForm, setEditForm] = useState<SessionFormState>({
    title: '',
    description: '',
    speakers: [newSpeakerRow()],
    location: '',
    room: '',
    start_time: '',
    end_time: '',
    session_types: ['breakout'],
    ratings_enabled: true,
    check_in_enabled: true,
  });
  const [editCustomTypeInput, setEditCustomTypeInput] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  const [addForm, setAddForm] = useState<SessionFormState>({
    title: '',
    description: '',
    speakers: [newSpeakerRow()],
    location: '',
    room: '',
    start_time: '',
    end_time: '',
    session_types: ['breakout'],
    ratings_enabled: true,
    check_in_enabled: true,
  });
  const [addCustomTypeInput, setAddCustomTypeInput] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [sessionNotifyNote, setSessionNotifyNote] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dayFilter, setDayFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ratings_off' | 'check_in_hidden'>('all');

  const notificationsPausedActive = isEventNotificationsPausedActive(event);

  const runSessionNotify = async (
    kind: 'added' | 'updated' | 'removed',
    options?: { sessionTitle?: string; sessionId?: string }
  ) => {
    if (!eventId) return;
    const result = await notifyScheduleChange(eventId, kind, options);
    setSessionNotifyNote(formatScheduleNotifyResult(result));
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase
          .from('events')
          .select('id, name, start_date, end_date, notifications_paused, notifications_paused_until')
          .eq('id', eventId)
          .single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: sessionsData, error } = await supabase
          .from('schedule_sessions')
          // * keeps load working if ratings_enabled (or other new cols) is missing before migration; mobile uses same pattern.
          .select('*')
          .eq('event_id', eventId)
          .order('day_number')
          .order('start_time');
        if (error) throw error;
        if (!cancelled) setSessions((sessionsData as ScheduleSession[]) ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !eventId || !event) return;
    e.target.value = '';
    setImportResult(null);
    setImporting(true);
    const errors: string[] = [];
    let added = 0;
    let failed = 0;
    try {
      const text = await file.text();
      const parsed = Papa.parse<unknown[]>(text, {
        header: false,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
      });
      const hardErrors = parsed.errors.filter((e) => e.type === 'Quotes' || e.code === 'InvalidQuotes');
      const e0 = hardErrors[0];
      if (e0) {
        setImportResult({
          added: 0,
          failed: 0,
          errors: [`CSV parse error: ${e0.message}${e0.row != null ? ` (row ${e0.row})` : ''}`],
        });
        setImporting(false);
        return;
      }
      const rawRows = (parsed.data as unknown[][]).filter(
        (row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim() !== '')
      );
      if (rawRows.length < 2) {
        setImportResult({ added: 0, failed: 0, errors: ['CSV must have a header row and at least one data row.'] });
        setImporting(false);
        return;
      }
      const table = rawRows.map((r) => r.map((c) => String(c ?? '').trim()));
      const eventStart = event.start_date ?? '';
      const headerCells = table[0] ?? [];
      const colMap = buildColumnMapFromHeaderRow(headerCells);

      const valuesToRowFromMap = (values: string[]): Record<string, string> => {
        const row: Record<string, string> = {};
        if (colMap) {
          CSV_HEADERS.forEach((h) => {
            const idx = colMap.get(h);
            row[h] = idx !== undefined ? (values[idx] ?? '').trim() : '';
          });
        } else {
          CSV_HEADERS.forEach((h, idx) => {
            row[h] = (values[idx] ?? '').trim();
          });
        }
        return row;
      };

      /** Map one data row to canonical fields; auto-detect legacy 15-col layout when 24-col positional would break dates. */
      const buildImportRow = (rowCells: string[]): Record<string, string> => {
        const values = rowCells.map((c) => String(c ?? '').trim());
        if (colMap) {
          const maxIdx = Math.max(0, ...Array.from(colMap.values()));
          const padded = [...values];
          while (padded.length <= maxIdx) padded.push('');
          return valuesToRowFromMap(padded);
        }
        const wideValues = [...values];
        while (wideValues.length < CSV_HEADERS.length) wideValues.push('');
        const wide = valuesToRowFromMap(wideValues);
        // Require date+time in the *canonical* wide columns — do not use event defaults here.
        // Otherwise a 15-column row padded to 24 leaves cols 19–20 empty and we'd accept wide with shifted location/speakers.
        const wideDateRaw = (wide.start_date || '').trim();
        const wideTimeRaw = (wide.start_time || '').trim();
        const wideStrictOk =
          parseDateToYMD(wideDateRaw) != null && parseTimeToHHMMLoose(wideTimeRaw) != null;
        if (wideStrictOk) return wide;

        const leg = valuesToRowLegacy15(values);
        const legD = (leg.start_date || '').trim() || eventStart;
        const legT = (leg.start_time || '').trim() || '09:00';
        const legParses =
          parseDateToYMD(legD) != null && parseTimeToHHMMLoose(legT) != null;

        // 24-column files that are still misaligned often put room in start_date and YYYY-MM-DD in start_time.
        const wideLooksShifted =
          /^\d{1,4}$/.test(wideDateRaw) ||
          /^\d{1,4}\s+\d{4}-\d{1,2}-\d{1,2}$/.test(wideDateRaw) ||
          (parseDateToYMD(wideTimeRaw) != null && parseTimeToHHMMLoose(wideTimeRaw) == null);

        if (legParses && (values.length < CSV_HEADERS.length || wideLooksShifted)) {
          return leg;
        }
        return wide;
      };

      for (let i = 1; i < table.length; i++) {
        const rowCells = table[i] ?? [];
        const row = buildImportRow(rowCells);
        if (!row.title) {
          failed++;
          errors.push(`Row ${i + 1}: title is required`);
          continue;
        }
        sanitizeScheduleRowDateCells(row);
        let startDateStr = row.start_date || eventStart;
        let startTimeStr = row.start_time || '09:00';
        let endDateStr = row.end_date || startDateStr;
        let endTimeStr = row.end_time || '10:00';

        const ns = normalizeDateTimePair(startDateStr, startTimeStr);
        startDateStr = ns.dateStr;
        startTimeStr = ns.timeStr;
        const ne = normalizeDateTimePair(endDateStr, endTimeStr);
        endDateStr = ne.dateStr;
        endTimeStr = ne.timeStr;

        const startYMD = parseDateToYMD(startDateStr);
        const endYMD = parseDateToYMD(endDateStr);
        const startHM = parseTimeToHHMMLoose(startTimeStr);
        const endHM = parseTimeToHHMMLoose(endTimeStr);

        if (!startYMD || !endYMD || !startHM || !endHM) {
          failed++;
          const commaHint =
            /[a-z]/i.test(startDateStr) || /[a-z]/i.test(endDateStr) || /[a-z]/i.test(startTimeStr) || /[a-z]/i.test(endTimeStr)
              ? ' Often caused by extra commas in title/description without CSV quotes, or columns in the wrong order—use the Download template header row.'
              : '';
          errors.push(
            `Row ${i + 1}: invalid date/time. start="${startDateStr} ${startTimeStr}", end="${endDateStr} ${endTimeStr}".${commaHint}`
          );
          continue;
        }

        // Store in UTC so the admin UI shows the same HH:MM regardless of browser timezone.
        const startDate = new Date(Date.UTC(startYMD.y, startYMD.m - 1, startYMD.d, startHM.h, startHM.m, 0, 0));
        const endDate = new Date(Date.UTC(endYMD.y, endYMD.m - 1, endYMD.d, endHM.h, endHM.m, 0, 0));
        const sessionType = serializeSessionTypes(normalizeSessionTypesList(row.session_type));
        const sp = speakersPayloadFromCsvRow(row);
        const payload = {
          event_id: eventId,
          title: row.title,
          description: row.description || null,
          speaker_name: sp.speaker_name,
          speaker_title: sp.speaker_title,
          speakers: sp.speakers,
          location: row.location || null,
          room: row.room || null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          day_number: getAgendaDayNumberFromStartIso(startDate.toISOString(), eventStart, event.end_date),
          session_type: sessionType,
          is_active: true,
          ratings_enabled: true,
          check_in_enabled: true,
        };
        const { error } = await supabase.from('schedule_sessions').insert(payload);
        if (error) {
          failed++;
          errors.push(`Row ${i + 1}: ${error.message}`);
        } else {
          added++;
        }
      }
      setImportResult({ added, failed, errors: errors.slice(0, 20) });
      if (added > 0) {
        const { data } = await supabase
          .from('schedule_sessions')
          .select('*')
          .eq('event_id', eventId)
          .order('day_number')
          .order('start_time');
        setSessions((data as ScheduleSession[]) ?? []);
      }
    } catch (err) {
      setImportResult({
        added: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : 'Failed to parse CSV'],
      });
    } finally {
      setImporting(false);
    }
  };

  // Convert stored ISO timestamptz into a datetime-local value without shifting time.
  // We treat the stored timestamp as UTC for the admin UI so edit shows the exact same HH:MM as the list.
  const toDateTimeLocalUTC = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  const parseDateTimeLocalAsUTC = (value: string) => {
    // value format: YYYY-MM-DDTHH:mm
    const [datePart, timePart] = value.split('T');
    const [ys, ms, ds] = (datePart || '').split('-');
    const y = parseInt(ys ?? '0', 10) || 0;
    const m = parseInt(ms ?? '1', 10) || 1;
    const d = parseInt(ds ?? '1', 10) || 1;

    const [hStr, minStr] = (timePart || '').split(':');
    const hh = parseInt(hStr ?? '0', 10) || 0;
    const mm = parseInt(minStr ?? '0', 10) || 0;

    return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
  };

  const openEdit = (s: ScheduleSession) => {
    setEditingSession(s);
    const eventStart = event?.start_date ?? null;
    const eventEnd = event?.end_date ?? null;
    const startDay = getAgendaDayNumberForTimestamp(s.start_time, eventStart, eventEnd, s.day_number);
    const endDay = getAgendaDayNumberForTimestamp(s.end_time, eventStart, eventEnd, s.day_number);
    setEditForm({
      title: s.title,
      description: s.description ?? '',
      speakers: sessionToSpeakerRows(s),
      location: s.location ?? '',
      room: s.room ?? '',
      // Derive day from actual timestamps so edit matches the day section we show (DB day_number can be wrong).
      start_time: toDateTimeLocalFromEventDayAndISO(s.start_time, startDay, eventStart) || toDateTimeLocalUTC(s.start_time),
      end_time: toDateTimeLocalFromEventDayAndISO(s.end_time, endDay, eventStart) || toDateTimeLocalUTC(s.end_time),
      session_types: normalizeSessionTypesList(s.session_type ?? 'breakout'),
      ratings_enabled: s.ratings_enabled !== false,
      check_in_enabled: s.check_in_enabled !== false,
    });
    setEditCustomTypeInput('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession || !eventId || !event) return;
    setSavingEdit(true);
    setSessionNotifyNote(null);
    try {
      const startDate = parseDateTimeLocalAsUTC(editForm.start_time);
      const endDate = parseDateTimeLocalAsUTC(editForm.end_time);
      const dayNumber = getAgendaDayNumberFromStartIso(startDate.toISOString(), event.start_date ?? '', event.end_date);
      const sp = speakersToDbPayload(editForm.speakers);
      const { error } = await supabase
        .from('schedule_sessions')
        .update({
          title: editForm.title.trim(),
          description: normalizeSessionDescription(editForm.description) || null,
          speaker_name: sp.speaker_name,
          speaker_title: sp.speaker_title,
          speakers: sp.speakers,
          location: editForm.location.trim() || null,
          room: editForm.room.trim() || null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          day_number: dayNumber,
          session_type: serializeSessionTypes(editForm.session_types),
          ratings_enabled: editForm.ratings_enabled,
          check_in_enabled: editForm.check_in_enabled,
        })
        .eq('id', editingSession.id);
      if (error) throw error;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === editingSession.id
            ? {
                ...s,
                title: editForm.title.trim(),
                description: normalizeSessionDescription(editForm.description) || null,
                speaker_name: sp.speaker_name,
                speaker_title: sp.speaker_title,
                speakers: sp.speakers ?? null,
                location: editForm.location.trim() || null,
                room: editForm.room.trim() || null,
                start_time: startDate.toISOString(),
                end_time: endDate.toISOString(),
                day_number: dayNumber,
                session_type: serializeSessionTypes(editForm.session_types),
                ratings_enabled: editForm.ratings_enabled,
                check_in_enabled: editForm.check_in_enabled,
              }
            : s
        )
      );
      setEditingSession(null);
      await runSessionNotify('updated', {
        sessionTitle: editForm.title.trim(),
        sessionId: editingSession.id,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSavingEdit(false);
    }
  };

  const openAdd = () => {
    if (!event) return;
    const dayKey = (event.start_date ?? '').slice(0, 10);
    const defaultStart = dayKey ? `${dayKey}T09:00` : '';
    const defaultEnd = dayKey ? `${dayKey}T10:00` : '';
    setAddForm({
      title: '',
      description: '',
      speakers: [newSpeakerRow()],
      location: '',
      room: '',
      start_time: defaultStart,
      end_time: defaultEnd,
      session_types: ['breakout'],
      ratings_enabled: true,
      check_in_enabled: true,
    });
    setAddCustomTypeInput('');
    setAddingSession(true);
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !event) return;
    if (!addForm.title.trim()) return;

    const startDate = parseDateTimeLocalAsUTC(addForm.start_time);
    const endDate = parseDateTimeLocalAsUTC(addForm.end_time);
    const dayNumber = getAgendaDayNumberFromStartIso(startDate.toISOString(), event.start_date ?? '', event.end_date);

    setSavingAdd(true);
    try {
      const sp = speakersToDbPayload(addForm.speakers);
      const payload = {
        event_id: eventId,
        title: addForm.title.trim(),
        description: normalizeSessionDescription(addForm.description) || null,
        speaker_name: sp.speaker_name,
        speaker_title: sp.speaker_title,
        speakers: sp.speakers,
        location: addForm.location.trim() || null,
        room: addForm.room.trim() || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        day_number: dayNumber,
        session_type: serializeSessionTypes(addForm.session_types),
        is_active: true,
        ratings_enabled: addForm.ratings_enabled,
        check_in_enabled: addForm.check_in_enabled,
      };

      const { data: inserted, error } = await supabase
        .from('schedule_sessions')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw error;

      setSessions((prev) => {
        const next = [...prev, inserted as ScheduleSession];
        next.sort((a, b) => {
          // stable ordering: day then start_time
          if (a.day_number !== b.day_number) return a.day_number - b.day_number;
          return a.start_time.localeCompare(b.start_time);
        });
        return next;
      });

      setAddingSession(false);
      await runSessionNotify('added', {
        sessionTitle: addForm.title.trim(),
        sessionId: (inserted as ScheduleSession).id,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSavingAdd(false);
    }
  };

  const handleDeleteSession = async (s: ScheduleSession) => {
    if (!eventId || !confirm(`Delete session "${s.title}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('schedule_sessions').delete().eq('id', s.id);
      if (error) throw error;
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      await runSessionNotify('removed', { sessionTitle: s.title, sessionId: s.id });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleDeleteAllSessions = async () => {
    if (!eventId || sessions.length === 0) return;
    const n = sessions.length;
    const label = event?.name?.trim() ? `"${event.name}"` : 'this event';
    if (
      !confirm(
        `Delete ALL ${n} session(s) for ${label}?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingAll(true);
    try {
      const { error } = await supabase.from('schedule_sessions').delete().eq('event_id', eventId);
      if (error) throw error;
      setSessions([]);
      setEditingSession(null);
      setImportResult(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete sessions');
    } finally {
      setDeletingAll(false);
    }
  };

  const dayOptions = useMemo(() => {
    return buildAgendaDayRows(sessions, event?.start_date, event?.end_date).map((row) => ({
      dateKey: row.dateKey,
      label: row.dateLabel,
      dayNum: row.dayNum,
      count: row.items.length,
    }));
  }, [sessions, event?.start_date, event?.end_date]);

  const sessionTypesInEvent = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      for (const t of normalizeSessionTypesList(s.session_type)) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const label = [s.room, s.location].filter(Boolean).join(', ').trim();
      if (label) set.add(label);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (dayFilter !== 'all') {
        const key = getSessionDateKeyFromIso(s.start_time);
        if (key !== dayFilter) return false;
      }
      if (typeFilter !== 'all') {
        if (!normalizeSessionTypesList(s.session_type).includes(typeFilter)) return false;
      }
      if (roomFilter !== 'all') {
        const place = [s.room, s.location].filter(Boolean).join(', ').trim();
        if (place !== roomFilter) return false;
      }
      if (statusFilter === 'ratings_off' && s.ratings_enabled !== false) return false;
      if (statusFilter === 'check_in_hidden' && s.check_in_enabled !== false) return false;
      if (q) {
        const hay = [
          s.title,
          s.description,
          s.room,
          s.location,
          formatSessionSpeakersLine(s),
          formatTime12FromISO(s.start_time),
          formatTime12FromISO(s.end_time),
          ...normalizeSessionTypesList(s.session_type),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, searchQuery, dayFilter, typeFilter, roomFilter, statusFilter]);

  const sessionsByDay = useMemo(
    () =>
      buildAgendaDayRows(filteredSessions, event?.start_date, event?.end_date).filter(
        (row) => row.items.length > 0
      ),
    [filteredSessions, event?.start_date, event?.end_date]
  );

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    dayFilter !== 'all' ||
    typeFilter !== 'all' ||
    roomFilter !== 'all' ||
    statusFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setDayFilter('all');
    setTypeFilter('all');
    setRoomFilter('all');
    setStatusFilter('all');
  };

  const formatTypeLabel = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Schedule — {event?.name ?? 'Event'}</h1>
      {notificationsPausedActive ? (
        <p className={styles.mutedBanner}>
          <strong>Notifications paused</strong> for this event — single session edits will not send push or in-app alerts until you unmute on the{' '}
          <Link to={`/events/${eventId}`}>event page</Link>.
        </p>
      ) : null}
      {sessionNotifyNote ? (
        <p className={styles.notifyNote} role="status">
          {sessionNotifyNote}
        </p>
      ) : null}
      <section className={styles.importSection}>
        <h2 className={styles.importSectionTitle}>Import sessions from CSV</h2>
        <p className={styles.hint}>
          Upload a CSV file to add multiple sessions at once. This is the fastest way to populate your schedule.
        </p>
        <details
          className={styles.csvHelpDetails}
          onToggle={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <summary className={styles.csvHelpSummary} onClick={(e) => e.stopPropagation()}>
            How to prepare your CSV
          </summary>
          <div className={styles.csvHelpBody}>
            <p>
              Don&apos;t change the column headers in the template. Just download it and fill in your session data.
              Column headers are already set up correctly.
            </p>
            <ul>
              <li>
                Dates: <code>YYYY-MM-DD</code> | Times: <code>HH:MM</code> (24-hour format)
              </li>
              <li>
                Times are in your event&apos;s timezone. If you change the timezone later, times auto-adjust—no
                re-import needed.
              </li>
              <li>
                Save as <strong>CSV UTF-8</strong> from Excel to avoid issues.
              </li>
            </ul>
          </div>
        </details>
        <div className={styles.importToolbar}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            disabled={deletingAll}
            className={styles.templateBtn}
            onClick={() => {
              const eventStart = event?.start_date ?? new Date().toISOString().slice(0, 10);
              const rowValues = [
                'Opening Keynote',
                'Welcome session',
                'Speaker Name',
                'CEO',
                'Company Inc',
                'Jane Doe',
                'VP of Strategy',
                'Second Company',
                ...Array(9).fill(''),
                'Main Hall',
                '101',
                eventStart,
                '09:00',
                eventStart,
                '10:00',
                'keynote',
              ];
              const row = rowValues
                .map((c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c))
                .join(',');
              const csv = [CSV_HEADERS.join(','), row].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'session-template.csv';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download CSV template
          </button>
          <button
            type="button"
            disabled={importing || deletingAll}
            className={styles.importBtn}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'Importing…' : 'Upload CSV and import'}
          </button>
          <button
            type="button"
            disabled={importing || addingSession || deletingAll}
            className={styles.importBtn}
            onClick={openAdd}
            title="Add a single session (no CSV)"
          >
            Add session
          </button>
          <Link className={styles.templateBtn} to={`/events/${eventId}/agenda-print`}>
            Printable agenda
          </Link>
          <button
            type="button"
            className={styles.deleteAllBtn}
            disabled={
              sessions.length === 0 ||
              importing ||
              deletingAll ||
              savingEdit ||
              savingAdd ||
              addingSession ||
              !!editingSession
            }
            title="Remove every session for this event"
            onClick={() => void handleDeleteAllSessions()}
          >
            {deletingAll ? 'Deleting…' : 'Delete all sessions'}
          </button>
        </div>
        {importResult && (
          <div className={styles.result}>
            <strong>Import result:</strong> {importResult.added} added, {importResult.failed} failed.
            {importResult.errors.length > 0 && (
              <ul className={styles.errorList}>
                {importResult.errors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
                {importResult.errors.length >= 20 && <li>…and more</li>}
              </ul>
            )}
          </div>
        )}
      </section>
      <h2 className={styles.listTitle}>Sessions ({sessions.length})</h2>
      {sessions.length > 0 ? (
        <>
          <div className={styles.filterPanel}>
            <input
              className={styles.searchInput}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, speaker, room, location, or type…"
              aria-label="Search sessions"
            />
            <div className={styles.filterRow}>
              <select
                className={styles.filterSelect}
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                aria-label="Filter by day"
              >
                <option value="all">All days</option>
                {dayOptions.map((d) => (
                  <option key={d.dateKey} value={d.dateKey}>
                    {d.dayNum != null ? `Day ${d.dayNum} — ${d.label}` : d.label} ({d.count})
                  </option>
                ))}
              </select>
              <select
                className={styles.filterSelect}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by session type"
              >
                <option value="all">All types</option>
                {sessionTypesInEvent.map((t) => (
                  <option key={t} value={t}>
                    {formatTypeLabel(t)}
                  </option>
                ))}
              </select>
              {roomOptions.length > 0 ? (
                <select
                  className={styles.filterSelect}
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value)}
                  aria-label="Filter by room or location"
                >
                  <option value="all">All rooms</option>
                  {roomOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                className={styles.filterSelect}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'ratings_off' | 'check_in_hidden')
                }
                aria-label="Filter by session options"
              >
                <option value="all">All options</option>
                <option value="ratings_off">Ratings off</option>
                <option value="check_in_hidden">Check-in hidden</option>
              </select>
              {hasActiveFilters ? (
                <button type="button" className={styles.clearFiltersBtn} onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
          <p className={styles.resultSummary}>
            Showing {filteredSessions.length} of {sessions.length} session
            {sessions.length === 1 ? '' : 's'}
            {hasActiveFilters ? ' (filtered)' : ''}
          </p>
        </>
      ) : null}
      {sessions.length === 0 ? (
        <p className={styles.empty}>No sessions yet. Import a CSV or add them in the mobile app.</p>
      ) : filteredSessions.length === 0 ? (
        <p className={styles.empty}>No sessions match your filters. Try clearing filters or changing your search.</p>
      ) : (
        <div className={styles.dayGroups}>
          {sessionsByDay.map(({ dayNum, dateLabel, dateKey, items }) => (
            <section key={dateKey} className={styles.daySection} aria-labelledby={`day-heading-${dateKey}`}>
              <div className={styles.daySectionHead}>
                <h3 id={`day-heading-${dateKey}`} className={styles.dayHeading}>
                  {dayNum != null ? (
                    <>
                      Day {dayNum}
                      {dateLabel ? <span className={styles.dayDate}> — {dateLabel}</span> : null}
                    </>
                  ) : (
                    <span className={styles.dayDate}>{dateLabel}</span>
                  )}
                </h3>
                <span className={styles.dayBadge}>{items.length} session{items.length === 1 ? '' : 's'}</span>
              </div>
              <ul className={styles.list}>
                {items.map((s) => (
                  <li key={s.id} className={styles.item}>
                    <span className={styles.itemTitle}>{s.title}</span>
                    <span className={styles.itemMeta}>
                      {formatTime12FromISO(s.start_time)} – {formatTime12FromISO(s.end_time)}
                      {formatSessionSpeakersLine(s) ? ` · ${formatSessionSpeakersLine(s)}` : ''}
                      {s.location ? ` · ${s.location}` : ''}
                      {s.ratings_enabled === false ? <span className={styles.ratingsOffBadge}> · Ratings off</span> : null}
                      {s.check_in_enabled === false ? (
                        <span className={styles.ratingsOffBadge}> · Check-in hidden</span>
                      ) : null}
                    </span>
                    <div className={styles.itemActions}>
                      <button type="button" className={`${styles.itemBtn} ${styles.itemBtnEdit}`} onClick={() => openEdit(s)}>
                        Edit
                      </button>
                      <button type="button" className={`${styles.itemBtn} ${styles.itemBtnDanger}`} onClick={() => handleDeleteSession(s)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editingSession && (
        <div className={styles.modalOverlay} onClick={() => setEditingSession(null)} role="dialog" aria-modal="true">
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Edit session</h2>
              <button type="button" className={styles.modalClose} onClick={() => setEditingSession(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className={styles.modalBody}>
              <label>Title</label>
              <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} required />
              <label>Description</label>
              <textarea
                rows={5}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Use one bullet per line, e.g. - Point 1"
              />
              <div className={styles.speakersBlock}>
                <div className={styles.speakersBlockHead}>
                  <span className={styles.speakersBlockTitle}>Speakers</span>
                  <button
                    type="button"
                    className={styles.addSpeakerBtn}
                    onClick={() => setEditForm((f) => ({ ...f, speakers: [...f.speakers, newSpeakerRow()] }))}
                  >
                    + Add speaker
                  </button>
                </div>
                {editForm.speakers.map((sp, spIdx) => (
                  <div key={sp.key} className={styles.speakerCard}>
                    <div className={styles.speakerCardHead}>
                      <span className={styles.speakerCardLabel}>Speaker {spIdx + 1}</span>
                      {editForm.speakers.length > 1 ? (
                        <button
                          type="button"
                          className={styles.removeSpeakerBtn}
                          onClick={() =>
                            setEditForm((f) => ({ ...f, speakers: f.speakers.filter((x) => x.key !== sp.key) }))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      placeholder="Name"
                      value={sp.name}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, name: e.target.value } : x)),
                        }))
                      }
                    />
                    <input
                      placeholder="Title / role"
                      value={sp.title}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, title: e.target.value } : x)),
                        }))
                      }
                    />
                    <input
                      placeholder="Company"
                      value={sp.company}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, company: e.target.value } : x)),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <label>Location / Room</label>
              <input value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} placeholder="Location" />
              <input value={editForm.room} onChange={(e) => setEditForm((f) => ({ ...f, room: e.target.value }))} placeholder="Room" />
              <label>Start (date & time)</label>
              <input type="datetime-local" value={editForm.start_time} onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))} required />
              <label>End (date & time)</label>
              <input type="datetime-local" value={editForm.end_time} onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))} required />
              <label>Session type (select multiple)</label>
              <div className={styles.typeRow}>
                {SESSION_TYPES.map((t) => {
                  const isSelected = editForm.session_types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.typeChip} ${isSelected ? styles.typeChipActive : ''}`}
                      onClick={() =>
                        setEditForm((f) => {
                          if (isSelected) {
                            const next = f.session_types.filter((x) => x !== t);
                            return { ...f, session_types: next.length > 0 ? next : [t] };
                          }
                          return { ...f, session_types: [...f.session_types, t] };
                        })
                      }
                    >
                      {t}
                    </button>
                  );
                })}
                {editForm.session_types
                  .filter((t) => !SESSION_TYPES.includes(t as (typeof SESSION_TYPES)[number]))
                  .map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.typeChip} ${styles.typeChipActive}`}
                      onClick={() =>
                        setEditForm((f) => {
                          const next = f.session_types.filter((x) => x !== t);
                          return { ...f, session_types: next.length > 0 ? next : ['breakout'] };
                        })
                      }
                    >
                      {t} x
                    </button>
                  ))}
              </div>
              <div className={styles.customTypeRow}>
                <input
                  value={editCustomTypeInput}
                  onChange={(e) => setEditCustomTypeInput(e.target.value)}
                  placeholder="Create custom type (e.g. Panel, Fireside)"
                />
                <button
                  type="button"
                  className={styles.customTypeAddBtn}
                  disabled={
                    !normalizeSessionTypeToken(editCustomTypeInput) ||
                    editForm.session_types.includes(normalizeSessionTypeToken(editCustomTypeInput))
                  }
                  onClick={() => {
                    const token = normalizeSessionTypeToken(editCustomTypeInput);
                    if (!token || editForm.session_types.includes(token)) return;
                    setEditForm((f) => ({ ...f, session_types: [...f.session_types, token] }));
                    setEditCustomTypeInput('');
                  }}
                >
                  Add
                </button>
              </div>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={editForm.ratings_enabled}
                  onChange={(e) => setEditForm((f) => ({ ...f, ratings_enabled: e.target.checked }))}
                />
                <span>Allow session ratings in the app (1–5 stars and optional feedback). Uncheck for breaks, meals, or non-rated sessions.</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={editForm.check_in_enabled}
                  onChange={(e) => setEditForm((f) => ({ ...f, check_in_enabled: e.target.checked }))}
                />
                <span>
                  Include in Session check-in (mobile app). Uncheck for breaks, meals, or sessions that do not need room
                  attendance.
                </span>
              </label>
              <button type="submit" className={styles.importBtn} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </form>
          </div>
        </div>
      )}

      {addingSession && (
        <div className={styles.modalOverlay} onClick={() => setAddingSession(false)} role="dialog" aria-modal="true">
          <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Add session</h2>
              <button type="button" className={styles.modalClose} onClick={() => setAddingSession(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={handleAddSession} className={styles.modalBody}>
              <label>Title</label>
              <input value={addForm.title} onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))} required />

              <label>Description</label>
              <textarea
                rows={5}
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Use one bullet per line, e.g. - Point 1"
              />

              <div className={styles.speakersBlock}>
                <div className={styles.speakersBlockHead}>
                  <span className={styles.speakersBlockTitle}>Speakers</span>
                  <button
                    type="button"
                    className={styles.addSpeakerBtn}
                    onClick={() => setAddForm((f) => ({ ...f, speakers: [...f.speakers, newSpeakerRow()] }))}
                  >
                    + Add speaker
                  </button>
                </div>
                {addForm.speakers.map((sp, spIdx) => (
                  <div key={sp.key} className={styles.speakerCard}>
                    <div className={styles.speakerCardHead}>
                      <span className={styles.speakerCardLabel}>Speaker {spIdx + 1}</span>
                      {addForm.speakers.length > 1 ? (
                        <button
                          type="button"
                          className={styles.removeSpeakerBtn}
                          onClick={() =>
                            setAddForm((f) => ({ ...f, speakers: f.speakers.filter((x) => x.key !== sp.key) }))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      placeholder="Name"
                      value={sp.name}
                      onChange={(e) =>
                        setAddForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, name: e.target.value } : x)),
                        }))
                      }
                    />
                    <input
                      placeholder="Title / role"
                      value={sp.title}
                      onChange={(e) =>
                        setAddForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, title: e.target.value } : x)),
                        }))
                      }
                    />
                    <input
                      placeholder="Company"
                      value={sp.company}
                      onChange={(e) =>
                        setAddForm((f) => ({
                          ...f,
                          speakers: f.speakers.map((x) => (x.key === sp.key ? { ...x, company: e.target.value } : x)),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>

              <label>Location / Room</label>
              <input value={addForm.location} onChange={(e) => setAddForm((f) => ({ ...f, location: e.target.value }))} placeholder="Location" />
              <input value={addForm.room} onChange={(e) => setAddForm((f) => ({ ...f, room: e.target.value }))} placeholder="Room" />

              <label>Start (date & time)</label>
              <input type="datetime-local" value={addForm.start_time} onChange={(e) => setAddForm((f) => ({ ...f, start_time: e.target.value }))} required />

              <label>End (date & time)</label>
              <input type="datetime-local" value={addForm.end_time} onChange={(e) => setAddForm((f) => ({ ...f, end_time: e.target.value }))} required />

              <label>Session type (select multiple)</label>
              <div className={styles.typeRow}>
                {SESSION_TYPES.map((t) => {
                  const isSelected = addForm.session_types.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.typeChip} ${isSelected ? styles.typeChipActive : ''}`}
                      onClick={() =>
                        setAddForm((f) => {
                          if (isSelected) {
                            const next = f.session_types.filter((x) => x !== t);
                            return { ...f, session_types: next.length > 0 ? next : [t] };
                          }
                          return { ...f, session_types: [...f.session_types, t] };
                        })
                      }
                    >
                      {t}
                    </button>
                  );
                })}
                {addForm.session_types
                  .filter((t) => !SESSION_TYPES.includes(t as (typeof SESSION_TYPES)[number]))
                  .map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${styles.typeChip} ${styles.typeChipActive}`}
                      onClick={() =>
                        setAddForm((f) => {
                          const next = f.session_types.filter((x) => x !== t);
                          return { ...f, session_types: next.length > 0 ? next : ['breakout'] };
                        })
                      }
                    >
                      {t} x
                    </button>
                  ))}
              </div>
              <div className={styles.customTypeRow}>
                <input
                  value={addCustomTypeInput}
                  onChange={(e) => setAddCustomTypeInput(e.target.value)}
                  placeholder="Create custom type (e.g. Panel, Fireside)"
                />
                <button
                  type="button"
                  className={styles.customTypeAddBtn}
                  disabled={
                    !normalizeSessionTypeToken(addCustomTypeInput) ||
                    addForm.session_types.includes(normalizeSessionTypeToken(addCustomTypeInput))
                  }
                  onClick={() => {
                    const token = normalizeSessionTypeToken(addCustomTypeInput);
                    if (!token || addForm.session_types.includes(token)) return;
                    setAddForm((f) => ({ ...f, session_types: [...f.session_types, token] }));
                    setAddCustomTypeInput('');
                  }}
                >
                  Add
                </button>
              </div>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={addForm.ratings_enabled}
                  onChange={(e) => setAddForm((f) => ({ ...f, ratings_enabled: e.target.checked }))}
                />
                <span>Allow session ratings in the app (1–5 stars and optional feedback). Uncheck for breaks, meals, or non-rated sessions.</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={addForm.check_in_enabled}
                  onChange={(e) => setAddForm((f) => ({ ...f, check_in_enabled: e.target.checked }))}
                />
                <span>
                  Include in Session check-in (mobile app). Uncheck for breaks, meals, or sessions that do not need room
                  attendance.
                </span>
              </label>

              <button type="submit" className={styles.importBtn} disabled={savingAdd}>
                {savingAdd ? 'Saving…' : 'Add'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
