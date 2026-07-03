-- Speed up common app queries flagged by Supabase performance advisor (unindexed FKs).
-- Safe additive change: no RLS or app behavior changes.

CREATE INDEX IF NOT EXISTS idx_announcements_event_id
  ON public.announcements (event_id);

CREATE INDEX IF NOT EXISTS idx_meeting_bookings_attendee_id
  ON public.meeting_bookings (attendee_id);

CREATE INDEX IF NOT EXISTS idx_event_members_user_id
  ON public.event_members (user_id);
