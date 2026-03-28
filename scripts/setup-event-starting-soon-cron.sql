-- Schedule the notify-event-starting-soon Edge Function to run every 2 minutes.
-- Run scripts/setup-session-reminder-5min.sql first to create session_reminder_sent table.
-- Requires: pg_cron and pg_net extensions (enable in Supabase Dashboard → Database → Extensions).
-- Vault: project_url, cron_secret (see ANNOUNCEMENTS-SETUP.md or REMINDERS-5MIN-DEPLOY.md).
-- Edge Function must have CRON_SECRET set (same value as vault cron_secret).
-- Repo supabase/config.toml sets verify_jwt = false for this function so cron does not need a user JWT.

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
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To unschedule later:
-- SELECT cron.unschedule('notify-event-starting-soon');
