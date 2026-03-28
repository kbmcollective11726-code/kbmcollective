-- Run this once in Supabase Dashboard → SQL Editor.
-- Creates the table required by the notify-b2b-meeting-soon Edge Function.

CREATE TABLE IF NOT EXISTS public.b2b_meeting_reminder_sent (
  booking_id uuid PRIMARY KEY REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_meeting_reminder_sent IS 'One row per booking when we sent the "meeting in 5 min" push. Used by notify-b2b-meeting-soon Edge Function.';

-- No policies: clients cannot read/write; service role (Edge Functions) bypasses RLS.
ALTER TABLE public.b2b_meeting_reminder_sent ENABLE ROW LEVEL SECURITY;
