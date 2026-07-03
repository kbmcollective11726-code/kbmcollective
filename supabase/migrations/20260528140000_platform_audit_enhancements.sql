-- Failed login tracking, orphan signup alerts, clickable audit tile details.

CREATE TABLE IF NOT EXISTS public.platform_security_alert_sent (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'orphan_signup',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_type)
);

ALTER TABLE public.platform_security_alert_sent ENABLE ROW LEVEL SECURITY;

-- Optional enterprise Auth Hook (Dashboard → Auth → Hooks → Password Verification Attempt):
--   pg-functions://postgres/public/hook_password_verification_attempt
CREATE OR REPLACE FUNCTION public.hook_password_verification_attempt(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_valid BOOLEAN;
BEGIN
  v_valid := COALESCE((event->>'valid')::boolean, false);
  v_user_id := NULLIF(trim(COALESCE(event->>'user_id', '')), '')::uuid;

  IF v_user_id IS NOT NULL THEN
    SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_user_id;
  END IF;
  IF v_email IS NULL AND event->>'email' IS NOT NULL THEN
    v_email := trim(event->>'email');
  END IF;

  PERFORM public.insert_platform_audit_log(
    'auth',
    CASE WHEN v_valid THEN 'login_success' ELSE 'login_failed' END,
    v_user_id,
    v_user_id,
    v_email,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('source', 'password_verification_hook', 'valid', v_valid)
  );

  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

REVOKE ALL ON FUNCTION public.hook_password_verification_attempt(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hook_password_verification_attempt(jsonb) TO supabase_auth_admin;

-- Allow security_alert notification type
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting',
      'schedule_change', 'connection_request', 'system', 'user_report', 'security_alert'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_orphan_signup(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_ids UUID[];
  uid UUID;
  title_text TEXT := 'Unrecognized account sign-up';
  body_text TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = p_user_id) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND COALESCE(u.is_platform_admin, false) = true
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_security_alert_sent s
    WHERE s.user_id = p_user_id AND s.alert_type = 'orphan_signup'
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
  INTO admin_ids
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = true;

  body_text := format(
    '%s (%s) signed up but is not on any event roster. Review in cadmin → Security audit.',
    COALESCE(NULLIF(trim(p_full_name), ''), 'Unknown'),
    COALESCE(NULLIF(trim(p_email), ''), 'no email')
  );

  IF admin_ids IS NOT NULL THEN
    FOREACH uid IN ARRAY admin_ids
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        uid,
        'security_alert',
        title_text,
        body_text,
        jsonb_build_object(
          'alert_type', 'orphan_signup',
          'user_id', p_user_id,
          'email', p_email
        )
      );
    END LOOP;
  END IF;

  INSERT INTO public.platform_security_alert_sent (user_id, alert_type)
  VALUES (p_user_id, 'orphan_signup')
  ON CONFLICT DO NOTHING;

  PERFORM public.insert_platform_audit_log(
    'security',
    'orphan_signup_alert',
    NULL,
    p_user_id,
    p_email,
    p_full_name,
    NULL,
    NULL,
    jsonb_build_object('source', 'orphan_signup_processor')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_platform_admins_orphan_signup(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_orphan_signup(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_platform_audit_tile_detail(
  p_tile TEXT,
  p_limit INT DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_rows jsonb;
  v_title TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_tile = 'total_users' THEN
    v_title := 'All accounts';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'full_name', coalesce(u.full_name, ''),
        'created_at', u.created_at,
        'last_login_at', u.last_login_at,
        'is_active', u.is_active IS DISTINCT FROM false,
        'is_platform_admin', u.is_platform_admin = true,
        'has_event_membership', EXISTS (
          SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
        )
      ) AS x,
      u.created_at AS ord
      FROM public.users u
      ORDER BY u.created_at DESC
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'orphan_accounts' THEN
    v_title := 'Accounts with no event membership';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'full_name', coalesce(u.full_name, ''),
        'created_at', u.created_at,
        'last_login_at', u.last_login_at,
        'is_active', u.is_active IS DISTINCT FROM false
      ) AS x,
      u.created_at AS ord
      FROM public.users u
      WHERE NOT EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = u.id)
        AND u.is_platform_admin IS DISTINCT FROM true
      ORDER BY u.created_at DESC
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'platform_admins' THEN
    v_title := 'Platform admins';
    SELECT COALESCE(jsonb_agg(x ORDER BY email), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'full_name', coalesce(u.full_name, ''),
        'last_login_at', u.last_login_at,
        'created_at', u.created_at
      ) AS x,
      u.email
      FROM public.users u
      WHERE u.is_platform_admin = true
      ORDER BY u.email
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'inactive_users' THEN
    v_title := 'Deactivated accounts';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'full_name', coalesce(u.full_name, ''),
        'created_at', u.created_at,
        'last_login_at', u.last_login_at
      ) AS x,
      u.updated_at AS ord
      FROM public.users u
      WHERE u.is_active = false
      ORDER BY u.updated_at DESC NULLS LAST
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'open_reports' THEN
    v_title := 'User reports';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'report_id', ur.id,
        'reason', ur.reason,
        'details', ur.details,
        'created_at', ur.created_at,
        'reporter_email', coalesce(ru.email, ''),
        'reporter_name', coalesce(ru.full_name, ''),
        'reported_email', coalesce(uu.email, ''),
        'reported_name', coalesce(uu.full_name, '')
      ) AS x,
      ur.created_at AS ord
      FROM public.user_reports ur
      LEFT JOIN public.users ru ON ru.id = ur.reporter_id
      LEFT JOIN public.users uu ON uu.id = ur.reported_user_id
      ORDER BY ur.created_at DESC
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'audit_events_7d' THEN
    v_title := 'Audit events (last 7 days)';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id', l.id,
        'created_at', l.created_at,
        'category', l.category,
        'action', l.action,
        'target_email', l.target_email,
        'target_name', l.target_name,
        'actor_email', coalesce(au.email, ''),
        'actor_name', coalesce(au.full_name, ''),
        'details', l.details
      ) AS x,
      l.created_at AS ord
      FROM public.platform_audit_log l
      LEFT JOIN public.users au ON au.id = l.actor_user_id
      WHERE l.created_at >= now() - interval '7 days'
      ORDER BY l.created_at DESC
      LIMIT v_limit
    ) q;

  ELSIF p_tile = 'failed_logins_7d' THEN
    v_title := 'Failed logins (last 7 days)';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id', l.id,
        'created_at', l.created_at,
        'target_email', l.target_email,
        'ip_address', l.ip_address,
        'details', l.details,
        'actor_email', coalesce(au.email, '')
      ) AS x,
      l.created_at AS ord
      FROM public.platform_audit_log l
      LEFT JOIN public.users au ON au.id = l.actor_user_id
      WHERE l.category = 'auth'
        AND l.action = 'login_failed'
        AND l.created_at >= now() - interval '7 days'
      ORDER BY l.created_at DESC
      LIMIT v_limit
    ) q;

  ELSE
    RETURN jsonb_build_object('error', 'unknown_tile');
  END IF;

  RETURN jsonb_build_object('tile', p_tile, 'title', v_title, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_audit_tile_detail(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_audit_tile_detail(TEXT, INT) TO authenticated;

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
      ),
      'failed_logins_7d', (
        SELECT COUNT(*)::INT FROM public.platform_audit_log
        WHERE category = 'auth'
          AND action = 'login_failed'
          AND created_at >= now() - interval '7 days'
      )
    ),
    'orphan_accounts', v_orphans,
    'platform_admins', v_platform_admins,
    'recent_signups', v_recent_signups
  );
END;
$$;
