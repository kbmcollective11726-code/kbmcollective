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
