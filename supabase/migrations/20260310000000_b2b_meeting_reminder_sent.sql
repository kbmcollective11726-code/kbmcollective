-- Track B2B meeting reminders sent so we don't send twice (cron runs every 1–2 min).
CREATE TABLE IF NOT EXISTS public.b2b_meeting_reminder_sent (
  booking_id uuid PRIMARY KEY REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_meeting_reminder_sent IS 'One row per booking when we sent the "meeting in 5 min" push. Used by notify-b2b-meeting-soon Edge Function.';
