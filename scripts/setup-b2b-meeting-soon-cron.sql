-- Schedule the notify-b2b-meeting-soon Edge Function to run every 2 minutes.
-- Run supabase/run-b2b-reminder-table.sql first (or npm run supabase:migrate) for b2b_meeting_reminder_sent.
-- Requires: pg_cron and pg_net extensions (enable in Supabase Dashboard → Database → Extensions).
-- Vault: project_url, cron_secret, anon_key. Edge Function CRON_SECRET must match vault cron_secret.
-- supabase/config.toml: verify_jwt = false for this function (cron uses x-cron-secret only).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

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

-- To unschedule later:
-- SELECT cron.unschedule('notify-b2b-meeting-soon');
