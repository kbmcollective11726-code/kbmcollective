import { supabase } from './supabase';

/** At-a-glance "met before" summary for one attendee (company-wide, across past events). */
export type VendorPriorInteractionFlag = {
  subject_user_id: string;
  prior_meetings_count: number;
  prior_notes_count: number;
  last_event_name: string | null;
  last_interaction_at: string | null;
};

export type VendorPriorMeeting = {
  event_id: string;
  event_name: string;
  event_end_date: string | null;
  start_time: string;
  end_time: string;
  vendor_name: string;
};

export type VendorPriorNote = {
  event_id: string;
  event_name: string;
  event_end_date: string | null;
  created_at: string;
  scanner_name: string;
  note: string;
  attended_meeting: boolean;
};

export type VendorAttendeeBrief = {
  brief: {
    user_id: string;
    full_name: string;
    title: string | null;
    company: string | null;
    bio: string | null;
    linkedin_url: string | null;
    avatar_url: string | null;
  };
  prior_meetings: VendorPriorMeeting[];
  prior_notes: VendorPriorNote[];
  met_before: boolean;
};

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Fetch prior-interaction flags for the attendees a vendor meets at this event. */
export async function fetchVendorPriorInteractionFlags(
  eventId: string,
  subjectIds?: string[],
  client: typeof supabase = supabase
): Promise<Map<string, VendorPriorInteractionFlag>> {
  const { data, error } = await client.rpc('list_vendor_prior_interaction_flags', {
    p_event_id: eventId,
    p_subject_ids: subjectIds && subjectIds.length > 0 ? subjectIds : null,
  });
  const out = new Map<string, VendorPriorInteractionFlag>();
  if (error) return out;
  const pack = data as { rows?: unknown[]; error?: string } | null;
  if (!pack || pack.error || !Array.isArray(pack.rows)) return out;
  for (const raw of pack.rows) {
    const r = raw as Record<string, unknown>;
    const id = typeof r.subject_user_id === 'string' ? r.subject_user_id : null;
    if (!id) continue;
    out.set(id, {
      subject_user_id: id,
      prior_meetings_count: toNum(r.prior_meetings_count),
      prior_notes_count: toNum(r.prior_notes_count),
      last_event_name: typeof r.last_event_name === 'string' ? r.last_event_name : null,
      last_interaction_at: typeof r.last_interaction_at === 'string' ? r.last_interaction_at : null,
    });
  }
  return out;
}

/** Full pre-meeting brief + prior meetings/notes for a single attendee. */
/** Save (or clear) a vendor/admin note about an attendee by user id — no badge token needed. */
export async function saveVendorAttendeeNote(
  eventId: string,
  subjectUserId: string,
  note: string,
  client: typeof supabase = supabase
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await client.rpc('upsert_vendor_attendee_note', {
    p_event_id: eventId,
    p_subject_user_id: subjectUserId,
    p_note: note,
  });
  if (error) return { error: error.message };
  const pack = data as { ok?: boolean; error?: string } | null;
  if (!pack || pack.error) return { error: pack?.error ?? 'save_failed' };
  return { ok: pack.ok === true };
}

export async function fetchVendorAttendeeBrief(
  eventId: string,
  subjectUserId: string,
  client: typeof supabase = supabase
): Promise<{ data?: VendorAttendeeBrief; error?: string }> {
  const { data, error } = await client.rpc('get_vendor_attendee_brief', {
    p_event_id: eventId,
    p_subject_user_id: subjectUserId,
  });
  if (error) return { error: error.message };
  const pack = data as (Partial<VendorAttendeeBrief> & { error?: string }) | null;
  if (!pack || pack.error) return { error: pack?.error ?? 'invalid_response' };
  if (!pack.brief) return { error: 'not_found' };
  return {
    data: {
      brief: pack.brief,
      prior_meetings: Array.isArray(pack.prior_meetings) ? pack.prior_meetings : [],
      prior_notes: Array.isArray(pack.prior_notes) ? pack.prior_notes : [],
      met_before: pack.met_before === true,
    },
  };
}
