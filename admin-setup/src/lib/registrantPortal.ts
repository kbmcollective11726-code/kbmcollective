import { supabase } from './supabase';
import type { Event, EventRegistrationSubmission } from './types';

export type PortalRole = 'delegate' | 'vendor';

export type RegistrationFlowMode = 'one_step' | 'two_step';

export type RegistrantPortalSettings = {
  registration_open: boolean;
  meeting_requests_open: boolean;
  max_meetings_per_attendee: number;
  schedule_locked: boolean;
  availability_deadline: string | null;
  delegate_portal_hotel_visible: boolean;
  delegate_hotel_content: string | null;
  delegate_stage2_active: boolean;
  vendor_stage2_active: boolean;
  stage2_holding_message: string | null;
  stage2_expected_open_at: string | null;
  /** one_step = full form on public register; two_step = Stage 1 then portal Stage 2. */
  registration_flow_mode: RegistrationFlowMode;
  /** Off by default — admin opt-in for suggested matches + why, per side. */
  portal_match_suggestions_vendors_enabled: boolean;
  portal_match_suggestions_delegates_enabled: boolean;
  /** Off by default — admin opt-in to show who requested the registrant. */
  portal_received_requests_visible: boolean;
};

export interface RegistrantPortalContext {
  event: RegistrantPortalEvent;
  settings: RegistrantPortalSettings;
  submission: EventRegistrationSubmission;
  reloadSubmission: () => Promise<void>;
}

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

/** Matches the Registration Details holding screen (delegate wording used for admin prefill). */
export const DEFAULT_HOLDING_SCHEDULE_MESSAGE =
  'Your event organizer has not released the full delegate registration profile yet. We will email you when it is ready to complete.';

export function holdingScheduleMessageForRole(role: PortalRole = 'delegate'): string {
  const label = role === 'vendor' ? 'vendor' : 'delegate';
  return `Your event organizer has not released the full ${label} registration profile yet. We will email you when it is ready to complete.`;
}

/** Always used as the Registration detail body starting content in Matchmaking. */
export function defaultHoldingBodyHtml(): string {
  return [
    `<p style="font-size: 20px; line-height: 1.45; color: #0f172a; font-weight: 600; margin-bottom: 14px;">`,
    `<span style="color: #1e4f8a; font-size: 22px;">Your registration is confirmed!</span><br>`,
    `Full profile setup opens soon — we will email you when it is ready.`,
    `</p>`,
    `<p style="font-size: 16px; line-height: 1.55; color: #1e3a5f; background-color: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #1e4f8a; border-radius: 8px; padding: 14px 16px; margin-top: 4px;">`,
    DEFAULT_HOLDING_SCHEDULE_MESSAGE,
    `</p>`,
  ].join('');
}

export function audienceForRole(role: PortalRole): 'attendee' | 'vendor' {
  return role === 'vendor' ? 'vendor' : 'attendee';
}

export function isRegistrationOneStep(settings: Pick<RegistrantPortalSettings, 'registration_flow_mode'>): boolean {
  return settings.registration_flow_mode === 'one_step';
}

export function isStage2Active(settings: RegistrantPortalSettings, role: PortalRole): boolean {
  // One-step registration already collected the full profile publicly — do not hold the portal.
  if (isRegistrationOneStep(settings)) return true;
  return role === 'vendor' ? settings.vendor_stage2_active : settings.delegate_stage2_active;
}

export async function loadRegistrantPortalSettings(eventId: string): Promise<RegistrantPortalSettings | null> {
  const { data, error } = await supabase
    .from('event_matchmaking_settings')
    .select(
      'registration_open, meeting_requests_open, max_meetings_per_attendee, schedule_locked, availability_deadline, delegate_portal_hotel_visible, delegate_hotel_content, delegate_stage2_active, vendor_stage2_active, stage2_holding_message, stage2_expected_open_at, registration_flow_mode, portal_match_suggestions_vendors_enabled, portal_match_suggestions_delegates_enabled, portal_received_requests_visible'
    )
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      registration_open: false,
      meeting_requests_open: false,
      max_meetings_per_attendee: 8,
      schedule_locked: false,
      availability_deadline: null,
      delegate_portal_hotel_visible: true,
      delegate_hotel_content: null,
      delegate_stage2_active: false,
      vendor_stage2_active: false,
      stage2_holding_message: null,
      stage2_expected_open_at: null,
      registration_flow_mode: 'two_step',
      portal_match_suggestions_vendors_enabled: false,
      portal_match_suggestions_delegates_enabled: false,
      portal_received_requests_visible: false,
    };
  }
  const row = data as RegistrantPortalSettings & { registration_flow_mode?: string | null };
  const flowMode: RegistrationFlowMode =
    row.registration_flow_mode === 'one_step' ? 'one_step' : 'two_step';
  return {
    registration_open: Boolean(row.registration_open),
    meeting_requests_open: Boolean(row.meeting_requests_open),
    max_meetings_per_attendee: row.max_meetings_per_attendee ?? 8,
    schedule_locked: row.schedule_locked === true,
    availability_deadline: row.availability_deadline ?? null,
    delegate_portal_hotel_visible: row.delegate_portal_hotel_visible !== false,
    delegate_hotel_content: row.delegate_hotel_content ?? null,
    delegate_stage2_active: Boolean(row.delegate_stage2_active),
    vendor_stage2_active: Boolean(row.vendor_stage2_active),
    stage2_holding_message: row.stage2_holding_message ?? null,
    stage2_expected_open_at: row.stage2_expected_open_at ?? null,
    registration_flow_mode: flowMode,
    portal_match_suggestions_vendors_enabled: Boolean(row.portal_match_suggestions_vendors_enabled),
    portal_match_suggestions_delegates_enabled: Boolean(row.portal_match_suggestions_delegates_enabled),
    portal_received_requests_visible: Boolean(row.portal_received_requests_visible),
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
