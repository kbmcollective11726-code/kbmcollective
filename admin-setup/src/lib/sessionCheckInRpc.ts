import { supabase } from './supabase';
import { formatTime12FromISO } from './agendaDayRows';

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

export function formatSessionSlotRange(start?: string, end?: string): string {
  const a = start ? formatTime12FromISO(start) : '';
  const b = end ? formatTime12FromISO(end) : '';
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
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
