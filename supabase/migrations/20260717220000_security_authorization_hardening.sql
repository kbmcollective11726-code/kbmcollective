-- Server-enforced authorization hardening:
-- 1) bind platform-admin email OTP verification to the authenticated session;
-- 2) deny protected public-schema access to deactivated authenticated users;
-- 3) enforce default solution-category ownership in the database.

CREATE TABLE IF NOT EXISTS public.platform_admin_step_up_sessions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  verified_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS platform_admin_step_up_sessions_expiry_idx
  ON public.platform_admin_step_up_sessions (verified_until);

ALTER TABLE public.platform_admin_step_up_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admin_step_up_sessions FROM anon, authenticated;

COMMENT ON TABLE public.platform_admin_step_up_sessions IS
  'Server-side platform-admin email OTP step-up, bound to a Supabase Auth session.';

CREATE OR REPLACE FUNCTION public.is_account_active(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT u.is_active IS NOT FALSE
      FROM public.users u
      WHERE u.id = p_user_id
        AND p_user_id IS NOT NULL
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_platform_admin_step_up(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.platform_admin_step_up_sessions s
      WHERE s.user_id = p_user_id
        AND s.session_id = NULLIF(auth.jwt() ->> 'session_id', '')
        AND s.verified_until > now()
    );
$$;

REVOKE ALL ON FUNCTION public.has_platform_admin_step_up(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_platform_admin_step_up(uuid) TO authenticated, service_role;

-- All existing RLS/RPC checks using is_platform_admin now require:
-- active account + email OTP verified for this exact Auth session.
CREATE OR REPLACE FUNCTION public.is_platform_admin(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT
        u.is_platform_admin = true
        AND u.is_active IS NOT FALSE
        AND public.has_platform_admin_step_up(p_user_id)
      FROM public.users u
      WHERE u.id = p_user_id
        AND p_user_id IS NOT NULL
    ),
    false
  );
$$;

-- Event-admin privileges also stop immediately when an account is deactivated.
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
    );
$$;

-- Restrictive policies are ANDed with every existing permissive policy. This
-- closes direct PostgREST access for a deactivated JWT without rewriting every
-- feature policy. Anon/public portal reads are intentionally unaffected.
DO $$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname NOT IN (
        'auth_login_attempts',
        'password_reset_requests',
        'platform_admin_login_otps',
        'platform_admin_step_up_sessions',
        'platform_security_alert_dedupe',
        'platform_security_alert_sent'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS active_accounts_only ON public.%I',
      table_row.table_name
    );

    IF table_row.table_name = 'users' THEN
      EXECUTE $policy$
        CREATE POLICY active_accounts_only ON public.users
          AS RESTRICTIVE
          FOR ALL
          TO authenticated
          USING (public.is_account_active((SELECT auth.uid())))
          WITH CHECK (
            public.is_account_active((SELECT auth.uid()))
            OR (
              id = (SELECT auth.uid())
              AND is_active IS NOT FALSE
            )
          )
      $policy$;
    ELSE
      EXECUTE format(
        'CREATE POLICY active_accounts_only ON public.%I
           AS RESTRICTIVE
           FOR ALL
           TO authenticated
           USING (public.is_account_active((SELECT auth.uid())))
           WITH CHECK (public.is_account_active((SELECT auth.uid())))',
        table_row.table_name
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_default_solution_category_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role/background operations have no end-user auth context.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_default = true AND NOT public.is_platform_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only a verified platform admin can create a default solution category'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default = true AND NOT public.is_platform_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only a verified platform admin can delete a default solution category'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.is_default IS DISTINCT FROM OLD.is_default
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a verified platform admin can change default solution-category status'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_solution_category_admin_only
  ON public.event_solution_categories;
CREATE TRIGGER trg_default_solution_category_admin_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.event_solution_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_default_solution_category_admin_only();

DROP POLICY IF EXISTS event_solution_categories_delete
  ON public.event_solution_categories;
DROP POLICY IF EXISTS event_solution_categories_insert
  ON public.event_solution_categories;
CREATE POLICY event_solution_categories_insert
  ON public.event_solution_categories
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (
    public.is_platform_admin((SELECT auth.uid()))
    OR (
      is_default IS NOT TRUE
      AND public.is_event_admin(event_id)
    )
  );

CREATE POLICY event_solution_categories_delete
  ON public.event_solution_categories
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR (
      is_default IS NOT TRUE
      AND public.is_event_admin(event_id)
    )
  );
