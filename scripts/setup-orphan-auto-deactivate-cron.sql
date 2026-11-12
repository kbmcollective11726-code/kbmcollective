-- Schedule orphan auto-deactivation once daily (04:00 UTC).
-- Requires vault secrets: project_url, cron_secret, anon_key (same as other crons).
-- Edge Function: process-orphan-auto-deactivate (CRON_SECRET must match vault cron_secret).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

SELECT cron.unschedule('process-orphan-auto-deactivate')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-orphan-auto-deactivate');

SELECT cron.schedule(
  'process-orphan-auto-deactivate',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-orphan-auto-deactivate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
