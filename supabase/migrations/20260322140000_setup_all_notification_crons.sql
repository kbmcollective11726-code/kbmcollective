-- Notification cron jobs + session_reminder_sent (see scripts/setup-all-notification-crons.sql for full comments).
-- Idempotent: unschedules same-named jobs then recreates them.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

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
