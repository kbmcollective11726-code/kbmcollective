-- Schedule the auto-deactivate-events Edge Function to run daily at 03:00 UTC.
-- Requires: pg_cron and pg_net extensions (enable in Supabase Dashboard → Database → Extensions).
-- Uses same vault secrets as other cron jobs (project_url, cron_secret).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;

SELECT cron.schedule(
  'auto-deactivate-events',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/auto-deactivate-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To unschedule later:
-- SELECT cron.unschedule('auto-deactivate-events');
