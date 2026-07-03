-- Platform-wide user security audit log (cadmin → Security audit).

CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  category TEXT NOT NULL CHECK (category IN ('auth', 'admin', 'security')),
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  target_user_id UUID,
  target_email TEXT,
  target_name TEXT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ip_address TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_created_at
  ON public.platform_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_category_action
  ON public.platform_audit_log (category, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_target_email
  ON public.platform_audit_log (lower(target_email), created_at DESC);

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_audit_log_platform_admin_select ON public.platform_audit_log;
CREATE POLICY platform_audit_log_platform_admin_select
  ON public.platform_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS platform_audit_log_platform_admin_insert ON public.platform_audit_log;
CREATE POLICY platform_audit_log_platform_admin_insert
  ON public.platform_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Service role / triggers insert without RLS when using SECURITY DEFINER helpers below.

CREATE OR REPLACE FUNCTION public.insert_platform_audit_log(
  p_category TEXT,
  p_action TEXT,
  p_actor_user_id UUID,
  p_target_user_id UUID DEFAULT NULL,
  p_target_email TEXT DEFAULT NULL,
  p_target_name TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.platform_audit_log (
    category,
    action,
    actor_user_id,
    target_user_id,
    target_email,
    target_name,
    event_id,
    ip_address,
    details
  ) VALUES (
    p_category,
    p_action,
    p_actor_user_id,
    p_target_user_id,
    NULLIF(trim(p_target_email), ''),
    NULLIF(trim(p_target_name), ''),
    p_event_id,
    NULLIF(trim(p_ip_address), ''),
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_platform_audit_log(
  TEXT, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_platform_audit_log(
  TEXT, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT, JSONB
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.audit_log_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.insert_platform_audit_log(
    'auth',
    'signup',
    NEW.id,
    NEW.id,
    NEW.email,
    NEW.full_name,
    NULL,
    NULL,
    jsonb_build_object('source', 'auth_signup')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_users_audit_signup ON public.users;
CREATE TRIGGER on_users_audit_signup
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_user_signup();

CREATE OR REPLACE FUNCTION public.audit_log_user_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reported_email TEXT;
  v_reported_name TEXT;
BEGIN
  SELECT u.email, u.full_name INTO v_reported_email, v_reported_name
  FROM public.users u
  WHERE u.id = NEW.reported_user_id;

  PERFORM public.insert_platform_audit_log(
    'security',
    'user_report',
    NEW.reporter_id,
    NEW.reported_user_id,
    v_reported_email,
    v_reported_name,
    NULL,
    NULL,
    jsonb_build_object(
      'report_id', NEW.id,
      'reason', NEW.reason,
      'details', NEW.details
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_reports_audit ON public.user_reports;
CREATE TRIGGER on_user_reports_audit
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_user_report();

CREATE OR REPLACE FUNCTION public.list_platform_user_audit(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0,
  p_category TEXT DEFAULT NULL,
  p_action TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_search TEXT := NULLIF(lower(trim(COALESCE(p_search, ''))), '');
  v_rows jsonb;
  v_total INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*)::INT INTO v_total
  FROM public.platform_audit_log l
  WHERE (p_category IS NULL OR p_category = '' OR l.category = p_category)
    AND (p_action IS NULL OR p_action = '' OR l.action = p_action)
    AND (
      v_search IS NULL
      OR lower(COALESCE(l.target_email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(l.target_name, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(l.details::text, '')) LIKE '%' || v_search || '%'
      OR EXISTS (
        SELECT 1 FROM public.users au
        WHERE au.id = l.actor_user_id
          AND (lower(COALESCE(au.email, '')) LIKE '%' || v_search || '%'
            OR lower(COALESCE(au.full_name, '')) LIKE '%' || v_search || '%')
      )
    );

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'category', l.category,
      'action', l.action,
      'target_user_id', l.target_user_id,
      'target_email', l.target_email,
      'target_name', l.target_name,
      'event_id', l.event_id,
      'ip_address', l.ip_address,
      'details', l.details,
      'actor', CASE
        WHEN au.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'user_id', au.id,
          'full_name', coalesce(au.full_name, ''),
          'email', coalesce(au.email, '')
        )
      END
    ) AS x,
    l.created_at AS ord
    FROM public.platform_audit_log l
    LEFT JOIN public.users au ON au.id = l.actor_user_id
    WHERE (p_category IS NULL OR p_category = '' OR l.category = p_category)
      AND (p_action IS NULL OR p_action = '' OR l.action = p_action)
      AND (
        v_search IS NULL
        OR lower(COALESCE(l.target_email, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(l.target_name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(l.details::text, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(au.email, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(au.full_name, '')) LIKE '%' || v_search || '%'
      )
    ORDER BY l.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) q;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_user_audit(INT, INT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_user_audit(INT, INT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_security_overview() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphans jsonb;
  v_platform_admins jsonb;
  v_recent_signups jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_orphans
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'full_name', coalesce(u.full_name, ''),
      'created_at', u.created_at,
      'last_login_at', u.last_login_at,
      'is_platform_admin', u.is_platform_admin = true,
      'is_active', u.is_active IS DISTINCT FROM false
    ) AS x,
    u.created_at AS ord
    FROM public.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
    )
    AND u.is_platform_admin IS DISTINCT FROM true
    ORDER BY u.created_at DESC
    LIMIT 50
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY email), '[]'::jsonb) INTO v_platform_admins
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'full_name', coalesce(u.full_name, ''),
      'last_login_at', u.last_login_at
    ) AS x,
    u.email
    FROM public.users u
    WHERE u.is_platform_admin = true
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_recent_signups
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'full_name', coalesce(u.full_name, ''),
      'created_at', u.created_at,
      'last_login_at', u.last_login_at,
      'has_event_membership', EXISTS (
        SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
      )
    ) AS x,
    u.created_at AS ord
    FROM public.users u
    ORDER BY u.created_at DESC
    LIMIT 25
  ) q;

  RETURN jsonb_build_object(
    'counts', jsonb_build_object(
      'total_users', (SELECT COUNT(*)::INT FROM public.users),
      'platform_admins', (SELECT COUNT(*)::INT FROM public.users WHERE is_platform_admin = true),
      'inactive_users', (SELECT COUNT(*)::INT FROM public.users WHERE is_active = false),
      'orphan_accounts', (
        SELECT COUNT(*)::INT FROM public.users u
        WHERE NOT EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = u.id)
          AND u.is_platform_admin IS DISTINCT FROM true
      ),
      'open_reports', (SELECT COUNT(*)::INT FROM public.user_reports),
      'audit_events_7d', (
        SELECT COUNT(*)::INT FROM public.platform_audit_log
        WHERE created_at >= now() - interval '7 days'
      )
    ),
    'orphan_accounts', v_orphans,
    'platform_admins', v_platform_admins,
    'recent_signups', v_recent_signups
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_security_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_security_overview() TO authenticated;
