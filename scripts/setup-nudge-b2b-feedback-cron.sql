-- Schedule the nudge-b2b-meeting-feedback Edge Function to run every 15 minutes.
-- Run after migrations that create b2b_meeting_feedback and b2b_meeting_feedback_nudge_sent.
-- Requires: pg_cron, pg_net, and vault secrets project_url, cron_secret, anon_key.
-- Edge Function: CRON_SECRET must match vault cron_secret.
-- supabase/config.toml: verify_jwt = false for this function.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

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

-- To unschedule: SELECT cron.unschedule('nudge-b2b-meeting-feedback');
