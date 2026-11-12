export interface User {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin?: boolean;
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  venue: string | null;
  start_date: string;
  end_date: string;
  banner_url: string | null;
  logo_url: string | null;
  theme_color: string;
  welcome_message: string | null;
  wifi_info: string | null;
  map_url: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
  event_code: string | null;
  welcome_title: string | null;
  welcome_subtitle: string | null;
  hero_stat_1: string | null;
  hero_stat_2: string | null;
  hero_stat_3: string | null;
  arrival_day_text: string | null;
  summit_days_text: string | null;
  theme_text: string | null;
  what_to_expect: string[] | null;
  points_section_intro: string | null;
  contact_phone: string | null;
  /** In-app hamburger: show 1:1 Meetings (default true). */
  menu_show_1on1?: boolean;
  /** In-app hamburger: show Live wall link (default true). */
  menu_show_live_wall?: boolean;
  /** In-app hamburger: show Solution Providers (default true). */
  menu_show_solution_providers?: boolean;
  /** In-app hamburger: show Scan badge link (platform-controlled; default off). */
  menu_show_scan_badge?: boolean;
  /** In-app hamburger: show Agenda link (default true). */
  menu_show_agenda?: boolean;
  /** In-app hamburger: show Notes for admins / vendor reps (default true). */
  menu_show_notes?: boolean;
  /** Vendor notes box on badge scans and the 1:1 Meetings page (default true). */
  menu_show_scan_notes?: boolean;
  menu_show_session_check_in?: boolean;
  /** Platform allows event admins to use Agenda in the app (they control menu_show_agenda). */
  platform_menu_show_agenda?: boolean;
  platform_menu_show_1on1?: boolean;
  platform_menu_show_scan_badge?: boolean;
  platform_menu_show_solution_providers?: boolean;
  platform_menu_show_live_wall?: boolean;
  platform_menu_show_notes?: boolean;
  platform_menu_show_scan_notes?: boolean;
  platform_menu_show_session_check_in?: boolean;
  /** Platform: duplicate bottom tabs in hamburger (default off). */
  platform_hamburger_show_info?: boolean;
  platform_hamburger_show_feed?: boolean;
  platform_hamburger_show_agenda?: boolean;
  platform_hamburger_show_community?: boolean;
  platform_hamburger_show_rank?: boolean;
  /** When true, vendors see 1:1 / unscheduled meeting check-in on badge scan (default false). */
  vendor_scan_show_meeting_checkin?: boolean;
  /** When true (default), vendors/admins see the pre-meeting attendee brief + "have we met before" history. */
  vendor_brief_enabled?: boolean;
  /** Printed on attendee badges (e.g. Hosted by …). */
  badge_host_footer?: string | null;
  /** Printed attendee badge line visibility: event name at top (default on). */
  badge_show_event_name?: boolean;
  /** Optional wide header for printed badges; falls back to banner_url then logo_url. */
  badge_banner_url?: string | null;
  /** Wide header for connect.kbmcollective.org delegate/vendor portal. */
  portal_banner_url?: string | null;
  /** When true, event-scoped notifications are muted (in-app + push). */
  notifications_paused?: boolean;
  /** Optional auto-unmute time; when elapsed, notifications resume automatically. */
  notifications_paused_until?: string | null;
  /** IANA zone for agenda wall-clock, Live now, and session starting-soon reminders. */
  reminder_timezone?: string | null;
  /** Admin console hub tiles visible to event admins (platform admins always see all). */
  admin_console_tiles?: string[] | null;
}

/** Event sponsor: tier + placement flags (Info / hamburger). */
export interface EventSponsor {
  id: string;
  event_id: string;
  company_name: string;
  logo_url: string | null;
  website_url: string | null;
  tier_label: string | null;
  sort_order: number;
  show_on_info_screen: boolean;
  show_in_hamburger?: boolean;
  show_in_hamburger_header?: boolean;
  show_in_hamburger_footer?: boolean;
  show_on_schedule: boolean;
  show_on_feed: boolean;
  /** Public live wall (browser); requires logo + migration RLS. */
  show_on_live_wall?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventSponsorCreative {
  id: string;
  sponsor_id: string;
  event_id: string;
  image_url: string;
  website_url: string | null;
  label: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type MatchmakingAudience = 'attendee' | 'vendor' | 'user';
export type MatchmakingQuestionType =
  | 'text'
  | 'textarea'
  | 'single_select'
  | 'multi_select'
  | 'boolean'
  | 'number'
  | 'email';

export interface EventRegistrationForm {
  id: string;
  event_id: string;
  name: string;
  /** Public URL segment for /register/:eventId/:audience/:slug */
  slug?: string | null;
  audience: MatchmakingAudience;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  /** Ordered section labels for Registration Details display. */
  section_order?: string[] | null;
  /** Standard registration form (no matchmaking). */
  is_standard?: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventRegistrationQuestion {
  id: string;
  form_id: string;
  prompt: string;
  is_base_question?: boolean;
  is_hidden?: boolean;
  /** Shown on participant profiles in Meeting Selections. Independent of is_hidden. */
  show_on_profile?: boolean;
  used_in_matching?: boolean;
  section_label: string | null;
  field_key: string | null;
  help_text: string | null;
  placeholder: string | null;
  question_type: MatchmakingQuestionType;
  is_required: boolean;
  condition_question_id?: string | null;
  condition_value?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EventRegistrationQuestionOption {
  id: string;
  question_id: string;
  label: string;
  value: string;
  sort_order: number;
  created_at: string;
}

export interface EventRegistrationSubmission {
  id: string;
  event_id: string;
  form_id: string;
  user_id: string | null;
  attendee_type: MatchmakingAudience;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  profile_complete?: boolean;
  registration_status?: 'pending_review' | 'approved' | 'rejected';
  matching_opt_in?: boolean;
  /** Theme tags from open-text goals (optional AI). Used in intelligent match scoring. */
  match_themes?: string[] | null;
  match_themes_updated_at?: string | null;
  /** When false, vendor/delegate cannot be scheduled (package without meetings). */
  meetings_enabled?: boolean;
  /** Optional per-registrant max meetings; null uses event default. */
  max_meetings?: number | null;
  meeting_availability?: unknown;
  /** Max overlapping meetings in one time slot (diaries). Default 1. */
  concurrent_meetings_per_slot?: number;
  rejected_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type MeetingInterestLevel = 'low' | 'medium' | 'high';
export type MeetingRequestResponseStatus = 'pending' | 'accepted' | 'declined';

export interface EventMeetingInterestRequest {
  id: string;
  event_id: string;
  submission_id: string;
  target_submission_id: string | null;
  target_company_name: string | null;
  target_person_name: string | null;
  reason: string | null;
  interest_level: MeetingInterestLevel | null;
  response_status: MeetingRequestResponseStatus;
  responded_at: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface ReceivedMeetingRequest {
  id: string;
  event_id: string;
  submission_id: string;
  target_submission_id: string;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_company_name: string | null;
  sender_job_title: string | null;
  reason: string | null;
  interest_level: MeetingInterestLevel | null;
  response_status: MeetingRequestResponseStatus;
  responded_at: string | null;
  created_at: string;
}

export interface ParticipantMatchmakingMeeting {
  id: string;
  counterpart_submission_id: string;
  counterpart_first_name: string | null;
  counterpart_last_name: string | null;
  counterpart_company_name: string | null;
  counterpart_job_title: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  slot_label: string | null;
  status: 'scheduled' | 'cancelled' | 'completed';
  published_to_app_at: string | null;
}

export interface EventRegistrationAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  answer_number: number | null;
  answer_boolean: boolean | null;
  answer_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface EventMatchReview {
  id: string;
  event_id: string;
  from_submission_id: string;
  to_submission_id: string;
  score: number;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventMatchScheduledMeeting {
  id: string;
  event_id: string;
  review_id: string | null;
  submission_a_id: string;
  submission_b_id: string;
  time_slot_id?: string | null;
  location_id?: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  notes?: string | null;
  status: 'scheduled' | 'cancelled' | 'completed';
  published_to_app_at?: string | null;
  app_booking_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventMatchmakingTimeSlot {
  id: string;
  event_id: string;
  start_time: string;
  end_time: string;
  label: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventMatchmakingLocation {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  sort_order: number;
  is_active: boolean;
  /** Optional home vendor for this table. */
  vendor_submission_id?: string | null;
  /** Linked Solution Provider booth (matchmaking bridge). */
  vendor_booth_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventMatchmakingAvailability {
  event_id: string;
  submission_id: string;
  time_slot_id: string;
  is_available: boolean;
  updated_at: string;
}

export type EventRole = 'attendee' | 'speaker' | 'vendor' | 'admin' | 'super_admin';

export interface EventMember {
  id: string;
  event_id: string;
  user_id: string;
  role: EventRole;
  roles?: EventRole[];
  points: number;
  user?: User;
}

export type SpeakerEntry = { name?: string; title?: string; company?: string | null };

export interface ScheduleSession {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  speaker_name: string | null;
  speaker_title: string | null;
  speakers?: SpeakerEntry[] | null;
  location: string | null;
  room: string | null;
  start_time: string;
  end_time: string;
  day_number: number;
  session_type: string;
  is_active: boolean;
  /** When false, the app hides star rating / feedback for this session (set in web admin Schedule). */
  ratings_enabled?: boolean;
  /** When false, hidden from mobile Session check-in list (set in web admin Schedule). */
  check_in_enabled?: boolean;
}

export interface B2BFeedbackRow {
  id: string;
  booking_id: string;
  attendee_id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  vendor_name: string | null;
  booth_id: string;
  slot_start: string;
  slot_end: string;
  rating: number;
  comment: string | null;
  meet_again: boolean;
  recommend_vendor: boolean;
  work_with_likelihood: number;
  created_at: string;
}

export interface SessionRatingRow {
  id: string;
  session_id: string;
  event_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  session_title: string | null;
  user_name: string | null;
  user_email: string | null;
}

export interface VendorBooth {
  id: string;
  event_id: string;
  vendor_name: string;
  description: string | null;
  logo_url: string | null;
  booth_location: string | null;
  contact_user_id: string | null;
  website: string | null;
  is_active: boolean;
  /** Matchmaking vendor registration that owns this booth (when auto-created). */
  registration_submission_id?: string | null;
  created_at: string;
}

export interface MeetingSlot {
  id: string;
  booth_id: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

export interface MeetingBookingRow {
  id: string;
  slot_id: string;
  attendee_id: string;
  status: string;
  notes: string | null;
  created_at: string;
  users?: { full_name: string; email: string } | null;
}
