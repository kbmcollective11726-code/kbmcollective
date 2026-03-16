-- Schedule the process-scheduled-announcements Edge Function to run every minute.
-- Requires: pg_cron and pg_net extensions (enable in Supabase Dashboard → Database → Extensions).
-- Requires: Run scripts/migrate-announcements-targeting.sql first so announcements has scheduled_at, sent_at, target_*.

-- 1. Store secrets in Vault (run once; replace with your values):
--    Supabase Dashboard → SQL Editor → run (see Vault docs for create_secret if needed):
--
--    SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--    SELECT vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'anon_key');
--    SELECT vault.create_secret('YOUR_CRON_SECRET_STRING', 'cron_secret');
--
--    Then set the same CRON_SECRET in Edge Function secrets:
--    Dashboard → Edge Functions → process-scheduled-announcements → Secrets → CRON_SECRET.

-- 2. Enable extensions (if not already):
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 3. Grant usage to postgres (pg_cron runs as postgres):
GRANT USAGE ON SCHEMA cron TO postgres;

-- 4. Schedule the Edge Function every minute:
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

-- To unschedule later:
-- SELECT cron.unschedule('process-scheduled-announcements');
