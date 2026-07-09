// ==================
// DATABASE TYPES
// ==================

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  bio: string | null;
  phone: string | null;
  push_token: string | null;
  /** When true (default), server skips agenda "starting soon" reminders if same room as previous bookmarked session that day. */
  session_reminder_skip_same_room?: boolean | null;
  is_active: boolean;
  is_platform_admin?: boolean;
  created_at: string;
  updated_at: string;
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
  // Join by code
  event_code: string | null;
  // Info page (admin-editable)
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
  /** Phone from "request to create event" signup; KBM uses for payment/setup. */
  contact_phone: string | null;
  /** Hamburger: 1:1 Meetings (default on). */
  menu_show_1on1?: boolean;
  /** Hamburger: Live wall (default on). */
  menu_show_live_wall?: boolean;
  /** Hamburger: Solution Provider (default on). */
  menu_show_solution_providers?: boolean;
  /** Hamburger: Scan badge (default on). */
  menu_show_scan_badge?: boolean;
  /** Hamburger: Agenda link (default on). */
  menu_show_agenda?: boolean;
  /** Hamburger: Notes (badge scans) for admins / vendor reps (default on). */
  menu_show_notes?: boolean;
  /** Hamburger: Session check-in (room badge scan) for event / platform admins. */
  menu_show_session_check_in?: boolean;
  /** Web hub tiles enabled for event admins (includes session_attendance). */
  admin_console_tiles?: string[] | null;
  platform_menu_show_agenda?: boolean;
  platform_menu_show_1on1?: boolean;
  platform_menu_show_scan_badge?: boolean;
  platform_menu_show_solution_providers?: boolean;
  platform_menu_show_live_wall?: boolean;
  platform_menu_show_notes?: boolean;
  platform_menu_show_session_check_in?: boolean;
  vendor_scan_show_meeting_checkin?: boolean;
  /** When true (default), vendors/admins see the pre-meeting attendee brief + "have we met before" history. */
  vendor_brief_enabled?: boolean;
  /** Printed on attendee badges (e.g. Hosted by …). */
  badge_host_footer?: string | null;
  /** Optional wide header strip for printed badges (cadmin). */
  badge_banner_url?: string | null;
  /** When true, event-scoped notifications are muted (in-app + push). */
  notifications_paused?: boolean;
  /** Optional auto-unmute time; when elapsed, notifications resume automatically. */
  notifications_paused_until?: string | null;
  /** IANA zone for agenda wall-clock (Live now, starting-soon reminders ~2–6 min). When set, matches `notify-event-starting-soon`. */
  reminder_timezone?: string | null;
}

export interface EventSponsor {
  id: string;
  event_id: string;
  company_name: string;
  logo_url: string | null;
  website_url: string | null;
  tier_label: string | null;
  sort_order: number;
  show_on_info_screen: boolean;
  /** Legacy one flag; prefer header + footer. Kept for old rows. */
  show_in_hamburger?: boolean;
  /** Small logo in drawer header beside "Menu". (Optional when using legacy `show_in_hamburger` only.) */
  show_in_hamburger_header?: boolean;
  /** "Mobile app sponsored by" block at bottom of drawer / strips. */
  show_in_hamburger_footer?: boolean;
  /** Compact strip on the Schedule tab (horizontal logos). */
  show_on_schedule: boolean;
  /** Compact strip at top of the event Feed. */
  show_on_feed: boolean;
  /** Logo strip on the public live wall (when enabled in admin). */
  show_on_live_wall?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Scheduled logo variant for a sponsor (time window in event wall-clock). */
export interface EventSponsorCreative {
  id: string;
  sponsor_id: string;
  event_id: string;
  image_url: string;
  label: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type EventRole = 'attendee' | 'speaker' | 'vendor' | 'admin' | 'super_admin';

export interface EventMember {
  id: string;
  event_id: string;
  user_id: string;
  /** Primary/display role (first in roles array). Kept for backward compat. */
  role: EventRole;
  /** All roles for this user in this event. Use this for multi-role (e.g. speaker + vendor). */
  roles?: EventRole[];
  points: number;
  joined_at: string;
  user?: User;
  /** Populated when membership is loaded with `events(*)` join. */
  events?: Event | null;
}

export interface Post {
  id: string;
  event_id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  image_hash: string | null;
  likes_count: number;
  comments_count: number;
  is_pinned: boolean;
  is_approved: boolean;
  is_deleted: boolean;
  created_at: string;
  user?: User;
  user_liked?: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: User;
}

export interface Like {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
}

export type SpeakerEntry = { name?: string; title?: string; company?: string | null; photo?: string | null };

export interface ScheduleSession {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  speaker_name: string | null;
  speaker_title: string | null;
  speaker_photo: string | null;
  speakers?: SpeakerEntry[] | null;
  location: string | null;
  room: string | null;
  start_time: string;
  end_time: string;
  day_number: number;
  track: string | null;
  session_type: 'keynote' | 'breakout' | 'workshop' | 'social' | 'meal' | 'networking' | 'vendor';
  is_active: boolean;
  sort_order: number;
  is_bookmarked?: boolean;
  /** When false, star rating / feedback is hidden for this session. */
  ratings_enabled?: boolean;
  /** When false, hidden from mobile Session check-in list. */
  check_in_enabled?: boolean;
}

export interface SessionRating {
  id: string;
  session_id: string;
  event_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
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
  created_at: string;
}

export type MeetingBookingStatus = 'requested' | 'confirmed' | 'declined' | 'cancelled';

export interface MeetingBooking {
  id: string;
  slot_id: string;
  attendee_id: string;
  status: MeetingBookingStatus;
  notes: string | null;
  created_at: string;
}

export interface B2BMeetingFeedback {
  id: string;
  booking_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  meet_again: boolean;
  recommend_vendor: boolean;
  work_with_likelihood: number;
  created_at: string;
}

export interface Message {
  id: string;
  event_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  sender?: User;
  receiver?: User;
}

export interface Announcement {
  id: string;
  event_id: string;
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  send_push: boolean;
  sent_by: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  event_id: string | null;
  type: 'like' | 'comment' | 'message' | 'announcement' | 'points' | 'badge' | 'meeting' | 'schedule_change' | 'connection_request' | 'system';
  title: string;
  body: string | null;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

export interface PointRule {
  id: string;
  event_id: string;
  action: string;
  points_value: number;
  max_per_day: number | null;
  description: string | null;
}

export interface PointLog {
  id: string;
  user_id: string;
  event_id: string;
  action: string;
  points: number;
  reference_id: string | null;
  description: string | null;
  created_at: string;
}

export interface VendorBoothWithRelations {
  id: string;
  event_id: string;
  vendor_name: string;
  description: string | null;
  logo_url: string | null;
  booth_location: string | null;
  contact_user_id: string | null;
  website: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface MeetingSlot {
  id: string;
  booth_id: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  booth?: VendorBooth;
}

export interface MeetingBooking {
  id: string;
  slot_id: string;
  attendee_id: string;
  status: 'requested' | 'confirmed' | 'declined' | 'cancelled';
  notes: string | null;
  created_at: string;
  slot?: MeetingSlot;
}

export interface Connection {
  id: string;
  event_id: string;
  user_id: string;
  connected_user_id: string;
  created_at: string;
  connected_user?: User;
}

// ==================
// APP STATE TYPES
// ==================

export interface AuthState {
  user: User | null;
  session: any | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface EventState {
  currentEvent: Event | null;
  events: Event[];
  membership: EventMember | null;
  isLoading: boolean;
}

export type PointAction =
  | 'post_photo'
  | 'receive_like'
  | 'give_like'
  | 'comment'
  | 'receive_comment'
  | 'connect'
  | 'attend_session'
  | 'complete_profile'
  | 'daily_streak'
  | 'vendor_meeting'
  | 'checkin'
  | 'share_linkedin'
  | 'session_feedback'
  | 'b2b_feedback';
