-- Table to track which schedule sessions already had a "starting in 5 mins" push sent.
-- Run this in Supabase SQL Editor before using the notify-event-starting-soon Edge Function.

CREATE TABLE IF NOT EXISTS public.session_reminder_sent (
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id)
);

ALTER TABLE public.session_reminder_sent ENABLE ROW LEVEL SECURITY;

-- Only service role / cron needs to insert; no app access needed.
CREATE POLICY "Service role can manage session_reminder_sent"
  ON public.session_reminder_sent FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.session_reminder_sent IS 'Tracks 5-min reminder push sent per schedule session for notify-event-starting-soon cron';
