-- PII retention: purge aged security logs (ASVS V8).
-- Schedule via pg_cron when available; function is safe to call manually.

CREATE OR REPLACE FUNCTION public.purge_expired_security_logs(
  p_login_attempt_days integer DEFAULT 90,
  p_audit_log_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer := 0;
  v_audit integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.auth_login_attempts
  WHERE created_at < now() - make_interval(days => GREATEST(p_login_attempt_days, 7));
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM public.platform_audit_log
  WHERE created_at < now() - make_interval(days => GREATEST(p_audit_log_days, 30));
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_login_attempts', v_attempts,
    'deleted_audit_rows', v_audit,
    'login_attempt_days', p_login_attempt_days,
    'audit_log_days', p_audit_log_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_security_logs(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_security_logs(integer, integer) TO service_role;

COMMENT ON FUNCTION public.purge_expired_security_logs(integer, integer) IS
  'Deletes aged auth_login_attempts (default 90d) and platform_audit_log (default 365d). service_role or platform admin only.';

-- Nightly purge when pg_cron is available (Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'purge-expired-security-logs';

    PERFORM cron.schedule(
      'purge-expired-security-logs',
      '15 4 * * *',
      $cron$SELECT public.purge_expired_security_logs(90, 365);$cron$
    );
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not ready; schedule purge_expired_security_logs manually';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule purge cron: %', SQLERRM;
END
$$;
