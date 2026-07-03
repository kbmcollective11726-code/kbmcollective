-- Schedule orphan signup alert processor every 10 minutes.
-- Requires vault secrets: project_url, cron_secret, anon_key (same as other crons).
-- Edge Function: process-orphan-signup-alerts (CRON_SECRET must match vault cron_secret).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

SELECT cron.unschedule('process-orphan-signup-alerts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-orphan-signup-alerts');

SELECT cron.schedule(
  'process-orphan-signup-alerts',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-orphan-signup-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
