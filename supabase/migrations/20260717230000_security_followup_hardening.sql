-- Follow-up authorization hardening discovered during the deep security trace.

UPDATE public.users SET is_active = true WHERE is_active IS NULL;
ALTER TABLE public.users
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_user_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF NEW.is_platform_admin IS NOT DISTINCT FROM OLD.is_platform_admin
     AND NEW.password_reset_blocked IS NOT DISTINCT FROM OLD.password_reset_blocked THEN
    RETURN NEW;
  END IF;

  IF v_role = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL OR NEW.id = v_uid OR NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'A verified platform admin must change protected account fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_user_security_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_users_protect_security_fields ON public.users;
CREATE TRIGGER trg_users_protect_security_fields
  BEFORE UPDATE OF is_platform_admin, password_reset_blocked ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_security_fields();

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

  IF EXISTS (
    SELECT 1
    FROM public.event_members em
    WHERE em.user_id = NEW.id
      AND public.is_event_admin(em.event_id)
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only event or verified platform admins can change account status'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_is_active_admin_only() FROM PUBLIC, anon, authenticated;

-- Event creation is a platform operation. Public event requests use the
-- dedicated create-event-request Edge Function instead.
DROP POLICY IF EXISTS events_insert_perm ON public.events;
CREATE POLICY events_insert_perm
  ON public.events
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin((SELECT auth.uid()))
    AND created_by = (SELECT auth.uid())
  );

-- Prevent arbitrary clients from forging actor IDs or audit entries.
CREATE OR REPLACE FUNCTION public.insert_platform_audit_log(
  p_category text,
  p_action text,
  p_actor_user_id uuid,
  p_target_user_id uuid DEFAULT NULL,
  p_target_email text DEFAULT NULL,
  p_target_name text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF NOT (v_role = 'service_role' OR session_user IN ('postgres', 'supabase_admin')) THEN
    IF v_uid IS NULL
       OR p_actor_user_id IS DISTINCT FROM v_uid
       OR NOT public.is_account_active(v_uid)
       OR NOT (
         public.is_platform_admin(v_uid)
         OR (p_event_id IS NOT NULL AND public.is_event_admin(p_event_id))
       ) THEN
      RAISE EXCEPTION 'Not authorized to write platform audit records'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.platform_audit_log (
    category, action, actor_user_id, target_user_id, target_email,
    target_name, event_id, ip_address, details
  )
  VALUES (
    p_category, p_action, p_actor_user_id, p_target_user_id,
    NULLIF(trim(p_target_email), ''), NULLIF(trim(p_target_name), ''),
    p_event_id, NULLIF(trim(p_ip_address), ''), COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_platform_audit_log(
  text, text, uuid, uuid, text, text, uuid, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_platform_audit_log(
  text, text, uuid, uuid, text, text, uuid, text, jsonb
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.add_creator_as_event_admin() FROM anon;

-- Storage operations are outside public-schema RLS, so add the same
-- deactivated-account boundary explicitly.
DROP POLICY IF EXISTS active_accounts_only ON storage.objects;
CREATE POLICY active_accounts_only
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.is_account_active((SELECT auth.uid())))
  WITH CHECK (public.is_account_active((SELECT auth.uid())));

-- Block deactivated sessions before PostgREST dispatches table or RPC access,
-- including SECURITY DEFINER RPCs that may bypass table RLS.
CREATE OR REPLACE FUNCTION public.enforce_active_postgrest_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND NOT public.is_account_active(auth.uid()) THEN
    RAISE EXCEPTION 'account_deactivated'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_active_postgrest_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_active_postgrest_request()
  TO anon, authenticated, service_role;

ALTER ROLE authenticator
  SET pgrst.db_pre_request = 'public.enforce_active_postgrest_request';
NOTIFY pgrst, 'reload config';

-- Reconcile accounts deactivated before Auth banning was introduced. Existing
-- access tokens are stopped by the guards above; the ban blocks login/refresh.
UPDATE auth.users au
SET banned_until = now() + interval '100 years',
    updated_at = now()
FROM public.users u
WHERE u.id = au.id
  AND u.is_active = false
  AND (au.banned_until IS NULL OR au.banned_until <= now());
