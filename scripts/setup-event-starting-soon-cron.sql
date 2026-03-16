-- Schedule the notify-event-starting-soon Edge Function to run every 2 minutes.
-- Run scripts/setup-session-reminder-5min.sql first to create session_reminder_sent table.
-- Requires: pg_cron and pg_net extensions (enable in Supabase Dashboard → Database → Extensions).
-- Uses same vault secrets as process-scheduled-announcements (project_url, anon_key, cron_secret).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

SELECT cron.schedule(
  'notify-event-starting-soon',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/notify-event-starting-soon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To unschedule later:
-- SELECT cron.unschedule('notify-event-starting-soon');
