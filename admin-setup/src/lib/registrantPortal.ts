import { supabase } from './supabase';
import type { Event, EventRegistrationSubmission } from './types';

export type PortalRole = 'delegate' | 'vendor';

export type RegistrantPortalSettings = {
  registration_open: boolean;
  meeting_requests_open: boolean;
  delegate_portal_hotel_visible: boolean;
  delegate_hotel_content: string | null;
  delegate_stage2_active: boolean;
  vendor_stage2_active: boolean;
  stage2_holding_message: string | null;
  stage2_expected_open_at: string | null;
};

export type RegistrantPortalEvent = Pick<
  Event,
  | 'id'
  | 'name'
  | 'description'
  | 'location'
  | 'venue'
  | 'start_date'
  | 'end_date'
  | 'banner_url'
  | 'logo_url'
  | 'badge_banner_url'
  | 'portal_banner_url'
  | 'welcome_message'
  | 'welcome_title'
>;

export const DEFAULT_HOLDING_MESSAGE =
  'Your registration is confirmed! Full profile setup opens soon — we will email you when it is ready.';

export function audienceForRole(role: PortalRole): 'attendee' | 'vendor' {
  return role === 'vendor' ? 'vendor' : 'attendee';
}

export function isStage2Active(settings: RegistrantPortalSettings, role: PortalRole): boolean {
  return role === 'vendor' ? settings.vendor_stage2_active : settings.delegate_stage2_active;
}

export async function loadRegistrantPortalSettings(eventId: string): Promise<RegistrantPortalSettings | null> {
  const { data, error } = await supabase
    .from('event_matchmaking_settings')
    .select(
      'registration_open, meeting_requests_open, delegate_portal_hotel_visible, delegate_hotel_content, delegate_stage2_active, vendor_stage2_active, stage2_holding_message, stage2_expected_open_at'
    )
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      registration_open: false,
      meeting_requests_open: false,
      delegate_portal_hotel_visible: true,
      delegate_hotel_content: null,
      delegate_stage2_active: false,
      vendor_stage2_active: false,
      stage2_holding_message: null,
      stage2_expected_open_at: null,
    };
  }
  const row = data as RegistrantPortalSettings;
  return {
    registration_open: Boolean(row.registration_open),
    meeting_requests_open: Boolean(row.meeting_requests_open),
    delegate_portal_hotel_visible: row.delegate_portal_hotel_visible !== false,
    delegate_hotel_content: row.delegate_hotel_content ?? null,
    delegate_stage2_active: Boolean(row.delegate_stage2_active),
    vendor_stage2_active: Boolean(row.vendor_stage2_active),
    stage2_holding_message: row.stage2_holding_message ?? null,
    stage2_expected_open_at: row.stage2_expected_open_at ?? null,
  };
}

export async function loadRegistrantPortalEvent(eventId: string): Promise<RegistrantPortalEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, description, location, venue, start_date, end_date, banner_url, logo_url, badge_banner_url, portal_banner_url, welcome_message, welcome_title',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as RegistrantPortalEvent | null) ?? null;
}

export async function linkAndLoadRegistrantSubmission(
  eventId: string,
  role: PortalRole
): Promise<EventRegistrationSubmission | null> {
  const rpc = role === 'vendor' ? 'link_my_vendor_submission' : 'link_my_delegate_submission';
  const { data: linkedId, error: linkErr } = await supabase.rpc(rpc, { p_event_id: eventId });
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

export function registrantStepPath(eventId: string, role: PortalRole, step: string): string {
  if (step === 'meetings/request') return `/portal/${eventId}/${role}/meetings/request`;
  if (step === 'meetings/sent') return `/portal/${eventId}/${role}/meetings/sent`;
  return `/portal/${eventId}/${role}/${step}`;
}
