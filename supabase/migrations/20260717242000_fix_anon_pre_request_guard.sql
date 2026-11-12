-- Keep the auth-only helper out of the anonymous execution path. PostgreSQL
-- validates nested calls when their branch runs, so anon requests no longer
-- require EXECUTE on is_account_active.
CREATE OR REPLACE FUNCTION public.enforce_active_postgrest_request()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT public.is_account_active(auth.uid()) THEN
      RAISE EXCEPTION 'account_deactivated'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_active_postgrest_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_active_postgrest_request()
  TO anon, authenticated, service_role;
