import { supabase } from './supabase';
import { formatSessionTime } from './scheduleNowNext';

export type SessionCheckInListItem = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
  room: string | null;
  day_number: number;
  check_in_count: number;
};

export type SessionCheckInResult = {
  ok: boolean;
  already_checked_in: boolean;
  checked_in_at?: string;
  check_in_count?: number;
  subject?: { user_id: string; full_name: string; email: string; company: string };
  session?: { id: string; title: string; start_time: string; end_time: string };
  error?: string;
};

export type SessionAttendanceReportRow = {
  user_id: string;
  full_name: string;
  email: string;
  company: string;
  bookmarked: boolean;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_in_by_name: string | null;
};

/** Wall-clock range (UTC field hours) — matches Agenda tab display. */
export function formatSessionSlotRange(start?: string, end?: string): string {
  if (!start) return '';
  if (end) return `${formatSessionTime(start)} – ${formatSessionTime(end)}`;
  return formatSessionTime(start);
}

export async function listSessionsForCheckIn(eventId: string): Promise<{
  rows?: SessionCheckInListItem[];
  error?: string;
}> {
  const { data: sessions, error: sErr } = await supabase
    .from('schedule_sessions')
    .select('id, title, start_time, end_time, location, room, day_number, check_in_enabled')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('start_time', { ascending: true });
  if (sErr) return { error: sErr.message };

  const eligible = (sessions ?? []).filter(
    (s) => (s as { check_in_enabled?: boolean }).check_in_enabled !== false
  );

  const ids = eligible.map((s) => s.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: checkIns, error: cErr } = await supabase
      .from('session_check_ins')
      .select('session_id')
      .in('session_id', ids);
    if (cErr && !/session_check_ins|schema cache/i.test(cErr.message)) {
      return { error: cErr.message };
    }
    for (const row of checkIns ?? []) {
      const sid = row.session_id as string;
      counts[sid] = (counts[sid] ?? 0) + 1;
    }
  }

  const rows: SessionCheckInListItem[] = eligible.map((s) => ({
    id: s.id,
    title: s.title,
    start_time: s.start_time,
    end_time: s.end_time,
    location: s.location,
    room: s.room,
    day_number: s.day_number ?? 1,
    check_in_count: counts[s.id] ?? 0,
  }));
  return { rows };
}

function parseRecordSessionCheckInResponse(data: unknown): SessionCheckInResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, already_checked_in: false, error: 'invalid_response' };
  }
  const row = data as Record<string, unknown>;
  if (typeof row.error === 'string' && row.error.length > 0) {
    return { ok: false, already_checked_in: false, error: row.error };
  }
  const alreadyRaw = row.already_checked_in;
  const already = alreadyRaw === true || alreadyRaw === 'true' || alreadyRaw === 1;
  const subject = row.subject as SessionCheckInResult['subject'];
  const session = row.session as SessionCheckInResult['session'];
  let checkInCount: number | undefined;
  if (typeof row.check_in_count === 'number' && Number.isFinite(row.check_in_count)) {
    checkInCount = row.check_in_count;
  } else if (typeof row.check_in_count === 'string') {
    const n = parseInt(row.check_in_count, 10);
    if (Number.isFinite(n)) checkInCount = n;
  }
  return {
    ok: row.ok !== false,
    already_checked_in: already,
    checked_in_at: typeof row.checked_in_at === 'string' ? row.checked_in_at : undefined,
    check_in_count: checkInCount,
    subject,
    session,
  };
}

export async function recordSessionCheckIn(
  sessionId: string,
  token: string
): Promise<SessionCheckInResult> {
  const { data, error } = await supabase.rpc('record_session_check_in', {
    p_session_id: sessionId,
    p_token: token,
  });
  if (error) {
    return { ok: false, already_checked_in: false, error: error.message ?? 'check_in_failed' };
  }
  return parseRecordSessionCheckInResponse(data);
}

export async function getSessionAttendanceReport(sessionId: string): Promise<{
  session?: Record<string, unknown>;
  rows?: SessionAttendanceReportRow[];
  stats?: Record<string, number>;
  error?: string;
}> {
  const { data, error } = await supabase.rpc('get_session_attendance_report', {
    p_session_id: sessionId,
  });
  if (error) return { error: error.message };
  const pack = data as {
    error?: string;
    session?: Record<string, unknown>;
    rows?: SessionAttendanceReportRow[];
    stats?: Record<string, number>;
  };
  if (pack?.error) return { error: pack.error };
  return {
    session: pack.session,
    rows: Array.isArray(pack.rows) ? pack.rows : [],
    stats: pack.stats,
  };
}
