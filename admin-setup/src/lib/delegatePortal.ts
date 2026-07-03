import { supabase } from './supabase';
import type { Event, EventRegistrationSubmission } from './types';

export type DelegatePortalSettings = {
  registration_open: boolean;
  meeting_requests_open: boolean;
  delegate_portal_hotel_visible: boolean;
  delegate_hotel_content: string | null;
};

export type DelegatePortalEvent = Pick<
  Event,
  'id' | 'name' | 'description' | 'location' | 'venue' | 'start_date' | 'end_date' | 'banner_url' | 'welcome_message' | 'welcome_title'
>;

export async function loadDelegatePortalSettings(eventId: string): Promise<DelegatePortalSettings | null> {
  const { data, error } = await supabase
    .from('event_matchmaking_settings')
    .select('registration_open, meeting_requests_open, delegate_portal_hotel_visible, delegate_hotel_content')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      registration_open: false,
      meeting_requests_open: false,
      delegate_portal_hotel_visible: true,
      delegate_hotel_content: null,
    };
  }
  const row = data as DelegatePortalSettings;
  return {
    registration_open: Boolean(row.registration_open),
    meeting_requests_open: Boolean(row.meeting_requests_open),
    delegate_portal_hotel_visible: row.delegate_portal_hotel_visible !== false,
    delegate_hotel_content: row.delegate_hotel_content ?? null,
  };
}

export async function loadDelegatePortalEvent(eventId: string): Promise<DelegatePortalEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, location, venue, start_date, end_date, banner_url, welcome_message, welcome_title')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as DelegatePortalEvent | null) ?? null;
}

export async function linkAndLoadDelegateSubmission(eventId: string): Promise<EventRegistrationSubmission | null> {
  const { data: linkedId, error: linkErr } = await supabase.rpc('link_my_delegate_submission', { p_event_id: eventId });
  if (linkErr) throw linkErr;
  const submissionId = typeof linkedId === 'string' ? linkedId : null;
  if (!submissionId) return null;

  const { data, error } = await supabase
    .from('event_registration_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  return (data as EventRegistrationSubmission | null) ?? null;
}

export function formatEventDateRange(start?: string | null, end?: string | null): string {
  if (!start && !end) return '';
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return start ? fmt(start) : end ? fmt(end) : '';
}

export async function userHasDelegatePortalAccess(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_submitted_delegate_registration', { p_event_id: eventId });
  if (error) throw error;
  return Boolean(data);
}
