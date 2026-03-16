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
  theme_color: string;
  event_code: string | null;
  is_active: boolean;
  created_at: string;
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
  is_active: boolean;
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
