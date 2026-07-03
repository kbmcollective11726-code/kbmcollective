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
  /** In-app hamburger: show Scan badge link (default true). */
  menu_show_scan_badge?: boolean;
  /** In-app hamburger: show Agenda link (default true). */
  menu_show_agenda?: boolean;
  /** In-app hamburger: show Notes for admins / vendor reps (default true). */
  menu_show_notes?: boolean;
  menu_show_session_check_in?: boolean;
  /** Platform allows event admins to use Agenda in the app (they control menu_show_agenda). */
  platform_menu_show_agenda?: boolean;
  platform_menu_show_1on1?: boolean;
  platform_menu_show_scan_badge?: boolean;
  platform_menu_show_solution_providers?: boolean;
  platform_menu_show_live_wall?: boolean;
  platform_menu_show_notes?: boolean;
  platform_menu_show_session_check_in?: boolean;
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
  audience: MatchmakingAudience;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EventRegistrationQuestion {
  id: string;
  form_id: string;
  prompt: string;
  is_base_question?: boolean;
  is_hidden?: boolean;
  section_label: string | null;
  field_key: string | null;
  help_text: string | null;
  placeholder: string | null;
  question_type: MatchmakingQuestionType;
  is_required: boolean;
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
  created_at: string;
  updated_at: string;
}

export interface EventMeetingInterestRequest {
  id: string;
  event_id: string;
  submission_id: string;
  target_company_name: string | null;
  target_person_name: string | null;
  reason: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
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
  start_time: string;
  end_time: string;
  location: string | null;
  status: 'scheduled' | 'cancelled' | 'completed';
  created_by: string | null;
  created_at: string;
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
