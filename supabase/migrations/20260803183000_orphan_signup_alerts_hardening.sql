-- Faster orphan candidate lookup (one DB round-trip) + longer pg_net timeout.
-- Edge was returning 500 on transient "Connection reset by peer" to PostgREST,
-- and pg_net's default 5s timeout raced the ~2–4s N+1 candidate scan.

CREATE OR REPLACE FUNCTION public.list_orphan_signup_candidates(
  p_min_age_minutes integer DEFAULT 10,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u.full_name, u.created_at
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = false
    AND u.created_at < now() - make_interval(mins => GREATEST(COALESCE(p_min_age_minutes, 10), 1))
    AND NOT EXISTS (
      SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.platform_security_alert_sent s
      WHERE s.user_id = u.id
        AND s.alert_type = 'orphan_signup'
    )
  ORDER BY u.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphan_signup_candidates(integer, integer) TO service_role;

-- Reschedule cron with 30s HTTP timeout (default is 5s).
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
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
