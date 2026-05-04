import { format, parseISO } from 'date-fns';
import { supabase } from './supabase';

export type ResolvedBadge = {
  event_id: string;
  scanner_kind?: string;
  /** Role bucket for the scanned person (attendee, vendor, admin, …) — for peer UI. */
  subject_kind?: string;
  subject: { user_id: string; full_name: string; email: string; company: string };
  event: { name: string; venue: string; badge_host_footer: string };
};

export function parseBadgeTokenFromQrData(data: string): string | null {
  const s = (data || '').trim();
  if (!s) return null;
  try {
    if (s.startsWith('collectivelive://')) {
      const q = s.split('?')[1];
      if (q) {
        const params = new URLSearchParams(q);
        const t = params.get('t') || params.get('token');
        if (t) return t.trim();
      }
      const pathMatch = s.match(/[?&]t=([^&#]+)/);
      if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    }
  } catch {
    /* ignore */
  }
  if (/^[a-f0-9]{48}$/i.test(s)) return s.toLowerCase();
  return null;
}

export async function resolveBadgeToken(token: string): Promise<{ data?: ResolvedBadge; error?: string }> {
  const { data, error } = await supabase.rpc('resolve_event_badge_token', { p_token: token });
  if (error) return { error: error.message };
  const row = data as { error?: string; subject_kind?: string } & Partial<ResolvedBadge>;
  if (row?.error === 'cannot_scan_own_badge') return { error: 'You cannot scan your own badge.' };
  if (row?.error) return { error: row.error };
  if (!row?.event_id || !row?.subject || !row?.event) return { error: 'invalid_response' };
  return {
    data: {
      event_id: row.event_id,
      scanner_kind: typeof row.scanner_kind === 'string' ? row.scanner_kind : undefined,
      subject_kind: typeof row.subject_kind === 'string' ? row.subject_kind : undefined,
      subject: row.subject as ResolvedBadge['subject'],
      event: row.event as ResolvedBadge['event'],
    },
  };
}

export type BadgeMeetingOption = {
  id: string;
  /** Server-built; may use DB timezone. Prefer {@link formatBadgeMeetingOptionLabel} for UI. */
  label: string;
  vendor_name?: string;
  start_time?: string;
  end_time?: string;
};

/** Format slot times in the device local timezone (Postgres `label` uses server TZ and is often wrong). */
export function formatBadgeMeetingOptionLabel(m: BadgeMeetingOption): string {
  const range = formatMeetingSlotRangeLocal(m.start_time, m.end_time);
  const vendor = (m.vendor_name || '').trim();
  if (vendor && range) return `${vendor} · ${range}`;
  if (range) return range;
  const fallback = (m.label || '').trim();
  return fallback || 'Meeting';
}

function formatMeetingSlotRangeLocal(start?: string, end?: string): string {
  if (!start) return '';
  try {
    const s = parseISO(String(start).replace(' ', 'T'));
    if (Number.isNaN(s.getTime())) return '';
    if (end) {
      const e = parseISO(String(end).replace(' ', 'T'));
      if (!Number.isNaN(e.getTime())) {
        return `${format(s, 'EEE, MMM d · h:mm a')} – ${format(e, 'h:mm a')}`;
      }
    }
    return format(s, 'EEE, MMM d · h:mm a');
  } catch {
    return '';
  }
}

export type VendorMeetingAttendanceRow = {
  id: string;
  subject_user_id: string;
  meeting_booking_id: string;
  attended_meeting: boolean;
  note: string;
  meeting_label?: string | null;
  updated_at: string;
};

/** Normalize booking id from JSON-RPC (string casing/types differ); safe for compare + upsert. */
export function normalizeMeetingBookingId(id: unknown): string | null {
  if (id == null || id === '') return null;
  const s = String(id).trim();
  return s.length > 0 ? s.toLowerCase() : null;
}

/** Bookings where the scanning attendee or speaker is booked with the scanned vendor's booth(s). Read-only. */
export async function listAttendeeMeetingsWithScannedVendor(token: string): Promise<{
  rows?: BadgeMeetingOption[];
  error?: string;
}> {
  const { data, error } = await supabase.rpc('list_badge_scan_attendee_with_vendor_meetings', { p_token: token });
  if (error) return { error: error.message };
  const pack = data as { rows?: BadgeMeetingOption[]; error?: string } | null;
  if (pack?.error) return { error: pack.error };
  const raw = pack?.rows;
  return { rows: Array.isArray(raw) ? raw : [] };
}

/** When a vendor scans an attendee (or admin scans): meetings for the scanned subject; vendors only see their booth. */
export async function listBadgeMeetingOptions(token: string): Promise<{
  rows?: BadgeMeetingOption[];
  error?: string;
}> {
  const { data, error } = await supabase.rpc('list_badge_scan_meeting_options', { p_token: token });
  if (error) return { error: error.message };
  const pack = data as { rows?: BadgeMeetingOption[]; error?: string } | null;
  if (pack?.error) return { error: pack.error };
  const raw = pack?.rows;
  const rows = Array.isArray(raw) ? raw : [];
  return { rows };
}

/**
 * Scan row for (current user as scanner, this subject, this event). RLS: scanner read own.
 * Restores note + general-visit `attended_meeting` when reopening the badge screen.
 */
export async function fetchMyBadgeScanForSubject(
  eventId: string,
  subjectUserId: string
): Promise<{ attended_meeting: boolean; note: string } | null> {
  const { data, error } = await supabase
    .from('badge_scans')
    .select('attended_meeting, note')
    .eq('event_id', eventId)
    .eq('subject_user_id', subjectUserId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { attended_meeting?: boolean; note?: string | null };
  return {
    attended_meeting: row.attended_meeting === true,
    note: typeof row.note === 'string' ? row.note : '',
  };
}

export async function listVendorMeetingAttendanceForSubject(
  eventId: string,
  subjectUserId: string
): Promise<{ rows?: VendorMeetingAttendanceRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('list_vendor_meeting_attendance_for_event', {
    p_event_id: eventId,
    p_subject_ids: [subjectUserId],
  });
  if (error) return { error: error.message };
  const pack = data as { rows?: VendorMeetingAttendanceRow[]; error?: string } | null;
  if (pack?.error) return { error: pack.error };
  const raw = pack?.rows;
  return { rows: Array.isArray(raw) ? raw : [] };
}

/** All per-meeting attendance rows for the current vendor rep at this event (source of truth for multi-meeting saves). */
export async function listVendorMeetingAttendanceForEvent(
  eventId: string
): Promise<{ rows?: VendorMeetingAttendanceRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('list_vendor_meeting_attendance_for_event', {
    p_event_id: eventId,
    p_subject_ids: null,
  });
  if (error) return { error: error.message };
  const pack = data as { rows?: VendorMeetingAttendanceRow[]; error?: string } | null;
  if (pack?.error) return { error: pack.error };
  const raw = pack?.rows;
  return { rows: Array.isArray(raw) ? raw : [] };
}

/**
 * `badge_scans` holds one summary row per (event, scanner, subject); after saving per-meeting toggles,
 * the final "general visit" upsert overwrites `attended_meeting` with only that switch. Per-meeting
 * truth lives in `badge_scan_meeting_attendance` (see `list_vendor_meeting_attendance_for_event`).
 */
export function vendorScanRowShowsAttended(
  scan: { attended_meeting: boolean; meeting_booking_id: string | null },
  perMeetingRows: VendorMeetingAttendanceRow[]
): boolean {
  if (perMeetingRows.some((x) => x.attended_meeting)) return true;
  if (scan.attended_meeting && (perMeetingRows.length === 0 || scan.meeting_booking_id == null)) return true;
  return false;
}

export async function upsertBadgeScan(
  token: string,
  note: string,
  attendedMeeting: boolean,
  meetingBookingId: string | null
): Promise<{ ok?: boolean; scanner_kind?: string; error?: string }> {
  const { data, error } = await supabase.rpc('upsert_badge_scan', {
    p_token: token,
    p_note: note,
    p_attended_meeting: attendedMeeting,
    p_meeting_booking_id: meetingBookingId,
  });
  if (error) return { error: error.message };
  const row = data as { error?: string; ok?: boolean; scanner_kind?: string };
  if (row?.error) return { error: row.error };
  return { ok: row.ok === true, scanner_kind: row.scanner_kind };
}
