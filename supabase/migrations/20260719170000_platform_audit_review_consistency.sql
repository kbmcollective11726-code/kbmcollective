-- Keep overview counts, suspicious list, and tile drill-downs aligned with
-- account recognition / risk-clear decisions.

CREATE OR REPLACE FUNCTION public.list_suspicious_users(
  p_limit INT DEFAULT 50,
  p_min_score INT DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack jsonb;
BEGIN
  v_pack := public.list_platform_account_reviews(p_limit, p_min_score);
  IF v_pack ? 'error' THEN
    RETURN v_pack;
  END IF;
  RETURN jsonb_build_object(
    'min_score', COALESCE(v_pack->'min_score', to_jsonb(GREATEST(COALESCE(p_min_score, 20), 0))),
    'rows', COALESCE(v_pack->'suspicious_rows', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_suspicious_users(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_suspicious_users(INT, INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_platform_security_overview() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphans jsonb;
  v_platform_admins jsonb;
  v_recent_signups jsonb;
  v_review jsonb;
  v_suspicious_count INT := 0;
  v_orphan_count INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_review := public.list_platform_account_reviews(50, 20);
  IF v_review ? 'error' THEN
    RETURN v_review;
  END IF;
  v_suspicious_count := COALESCE((v_review->>'suspicious_count')::INT, 0);
  v_orphan_count := COALESCE((v_review->>'orphan_count')::INT, 0);
  v_orphans := COALESCE(v_review->'orphan_rows', '[]'::jsonb);

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
      'orphan_accounts', v_orphan_count,
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
      ),
      'brute_force_alerts_24h', (
        SELECT COUNT(*)::INT FROM public.platform_security_alert_dedupe d
        WHERE d.sent_at >= now() - interval '24 hours'
          AND d.alert_type IN ('brute_force_email', 'brute_force_ip', 'ip_scan')
      ),
      'safety_repeat_offenders', (
        SELECT COUNT(*)::INT FROM (
          SELECT ur.reported_user_id
          FROM public.user_reports ur
          GROUP BY ur.reported_user_id
          HAVING COUNT(*) >= 2
        ) t
      ),
      'suspicious_users', v_suspicious_count,
      'total_blocks', (SELECT COUNT(*)::INT FROM public.blocked_users)
    ),
    'orphan_accounts', v_orphans,
    'platform_admins', v_platform_admins,
    'recent_signups', v_recent_signups
  );
END;
$$;

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
  v_pack jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_tile = 'suspicious_users' THEN
    v_pack := public.list_platform_account_reviews(v_limit, 20);
    IF v_pack ? 'error' THEN
      RETURN v_pack;
    END IF;
    RETURN jsonb_build_object(
      'tile', p_tile,
      'title', 'Accounts needing review (score >= 20)',
      'rows', COALESCE(v_pack->'suspicious_rows', '[]'::jsonb)
    );
  ELSIF p_tile = 'orphan_accounts' THEN
    v_pack := public.list_platform_account_reviews(v_limit, 20);
    IF v_pack ? 'error' THEN
      RETURN v_pack;
    END IF;
    RETURN jsonb_build_object(
      'tile', p_tile,
      'title', 'Unrecognized accounts (no event membership)',
      'rows', COALESCE(v_pack->'orphan_rows', '[]'::jsonb)
    );
  ELSIF p_tile = 'safety_repeat_offenders' THEN
    v_pack := public.list_platform_safety_overview(v_limit);
    RETURN jsonb_build_object(
      'tile', p_tile,
      'title', 'Repeat offenders (2+ reports)',
      'rows', COALESCE(v_pack->'repeat_offenders', '[]'::jsonb)
    );
  ELSIF p_tile = 'brute_force_alerts_24h' THEN
    v_title := 'Brute-force alerts (last 24 hours)';
    SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'alert_type', d.alert_type,
        'dedupe_key', d.dedupe_key,
        'sent_at', d.sent_at,
        'details', d.details
      ) AS x,
      d.sent_at AS ord
      FROM public.platform_security_alert_dedupe d
      WHERE d.sent_at >= now() - interval '24 hours'
        AND d.alert_type IN ('brute_force_email', 'brute_force_ip', 'ip_scan')
      ORDER BY d.sent_at DESC
      LIMIT v_limit
    ) q;
    RETURN jsonb_build_object('tile', p_tile, 'title', v_title, 'rows', v_rows);
  ELSIF p_tile = 'total_blocks' THEN
    v_pack := public.list_platform_safety_overview(v_limit);
    RETURN jsonb_build_object(
      'tile', p_tile,
      'title', 'User blocks (all events)',
      'rows', COALESCE(v_pack->'blocks', '[]'::jsonb)
    );
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
        'last_login_at', u.last_login_at,
        'is_active', false
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
    RETURN jsonb_build_object('error', 'unknown_tile', 'tile', p_tile);
  END IF;

  RETURN jsonb_build_object('tile', p_tile, 'title', v_title, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;
