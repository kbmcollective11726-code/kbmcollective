-- =============================================================================
-- ALL SERVER-DRIVEN NOTIFICATIONS — run once in Supabase → SQL Editor
-- =============================================================================
--
-- BEFORE THIS SCRIPT (one-time):
-- 1) Vault secrets (Dashboard → SQL or Vault UI):
--      SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--      SELECT vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'anon_key');
--      SELECT vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'cron_secret');
-- 2) Edge Function secrets (same CRON_SECRET value on EACH):
--      process-scheduled-announcements
--      notify-event-starting-soon
--      notify-b2b-meeting-soon
--      nudge-b2b-meeting-feedback
-- 3) Extensions: Database → Extensions → enable pg_cron, pg_net (if not on)
-- 4) Tables: b2b_meeting_reminder_sent — run supabase/run-b2b-reminder-table.sql if missing
--
-- This script: session_reminder_sent + replaces cron jobs so all timers run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

-- ---------- session_reminder_sent (5-min session push dedup) ----------
CREATE TABLE IF NOT EXISTS public.session_reminder_sent (
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id)
);
ALTER TABLE public.session_reminder_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage session_reminder_sent" ON public.session_reminder_sent;
CREATE POLICY "Service role can manage session_reminder_sent"
  ON public.session_reminder_sent FOR ALL
  USING (true)
  WITH CHECK (true);
COMMENT ON TABLE public.session_reminder_sent IS 'Tracks 5-min reminder push per session (notify-event-starting-soon).';

-- ---------- Remove old jobs with same names (idempotent) ----------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'process-scheduled-announcements',
      'notify-event-starting-soon',
      'notify-b2b-meeting-soon',
      'nudge-b2b-meeting-feedback'
    )
  ) LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- ---------- Schedule: scheduled announcements (every minute) ----------
SELECT cron.schedule(
  'process-scheduled-announcements',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-scheduled-announcements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------- Schedule: session ~5 min before (every 2 min) ----------
SELECT cron.schedule(
  'notify-event-starting-soon',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/notify-event-starting-soon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------- Schedule: B2B meeting ~5 min before (every 2 min) ----------
SELECT cron.schedule(
  'notify-b2b-meeting-soon',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/notify-b2b-meeting-soon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ---------- Schedule: B2B feedback nudge (every 15 min) ----------
SELECT cron.schedule(
  'nudge-b2b-meeting-feedback',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/nudge-b2b-meeting-feedback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verify:
-- SELECT jobname, schedule FROM cron.job ORDER BY jobname;
