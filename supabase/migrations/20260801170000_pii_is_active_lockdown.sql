-- ASVS remediations: narrow sensitive user columns, platform-only global is_active,
-- event-admin must be on an active membership.

-- ---------------------------------------------------------------------------
-- 1) Global deactivate: platform admin / service_role only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_is_active_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  IF v_role = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL OR NEW.id = v_uid THEN
    RAISE EXCEPTION 'Accounts cannot change their own active status'
      USING ERRCODE = '42501';
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a verified platform admin can change global account status'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.enforce_is_active_admin_only() IS
  'Only platform admins (or service_role) may change users.is_active. Event suspend uses event_members.is_active.';

-- ---------------------------------------------------------------------------
-- 2) Event admin helper: require active membership
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_active(auth.uid()) AND EXISTS (
    SELECT 1
    FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND em.user_id = auth.uid()
      AND COALESCE(em.is_active, true) = true
      AND (
        em.role IN ('admin', 'super_admin')
        OR (em.roles IS NOT NULL AND (em.roles && ARRAY['admin'::text, 'super_admin'::text]))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 3) Hide highly sensitive columns from direct PostgREST SELECT
--    (self/admin full row via get_my_user_profile / service_role)
-- ---------------------------------------------------------------------------
REVOKE SELECT (push_token, password_reset_blocked) ON TABLE public.users FROM PUBLIC;
REVOKE SELECT (push_token, password_reset_blocked) ON TABLE public.users FROM anon;
REVOKE SELECT (push_token, password_reset_blocked) ON TABLE public.users FROM authenticated;

-- Keep UPDATE on push_token for device registration (self updates via RLS)
GRANT UPDATE (push_token) ON TABLE public.users TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_user_profile()
RETURNS public.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.*
  FROM public.users u
  WHERE u.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_user_profile() TO authenticated;

COMMENT ON FUNCTION public.get_my_user_profile() IS
  'Returns the caller''s full users row including columns revoked from direct SELECT (e.g. push_token).';
