-- Brute-force anomaly alerts, cross-event safety overview, suspicious user scoring.

CREATE TABLE IF NOT EXISTS public.platform_security_alert_dedupe (
  alert_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (alert_type, dedupe_key)
);

ALTER TABLE public.platform_security_alert_dedupe ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_security_alert(
  p_alert_type TEXT,
  p_dedupe_key TEXT,
  p_title TEXT,
  p_body TEXT,
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_ids UUID[];
  uid UUID;
BEGIN
  IF NULLIF(trim(p_alert_type), '') IS NULL OR NULLIF(trim(p_dedupe_key), '') IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_security_alert_dedupe d
    WHERE d.alert_type = p_alert_type AND d.dedupe_key = p_dedupe_key
  ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
  INTO admin_ids
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = true;

  IF admin_ids IS NOT NULL THEN
    FOREACH uid IN ARRAY admin_ids
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        uid,
        'security_alert',
        p_title,
        p_body,
        jsonb_build_object(
          'alert_type', p_alert_type,
          'dedupe_key', p_dedupe_key
        ) || COALESCE(p_details, '{}'::jsonb)
      );
    END LOOP;
  END IF;

  INSERT INTO public.platform_security_alert_dedupe (alert_type, dedupe_key, details)
  VALUES (p_alert_type, p_dedupe_key, COALESCE(p_details, '{}'::jsonb))
  ON CONFLICT DO NOTHING;

  PERFORM public.insert_platform_audit_log(
    'security',
    p_alert_type,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'dedupe_key', p_dedupe_key,
      'title', p_title,
      'body', p_body
    ) || COALESCE(p_details, '{}'::jsonb)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_platform_admins_security_alert(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_security_alert(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.process_brute_force_anomaly_alerts() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window INTERVAL := interval '15 minutes';
  v_bucket BIGINT;
  v_sent INT := 0;
  r RECORD;
BEGIN
  v_bucket := floor(extract(epoch FROM now()) / 900)::bigint;

  FOR r IN
    SELECT lower(trim(l.target_email)) AS email_key, COUNT(*)::INT AS cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - v_window
      AND NULLIF(trim(l.target_email), '') IS NOT NULL
    GROUP BY lower(trim(l.target_email))
    HAVING COUNT(*) >= 5
  LOOP
    IF public.notify_platform_admins_security_alert(
      'brute_force_email',
      'email:' || r.email_key || ':' || v_bucket::text,
      'Possible brute-force login',
      format('%s failed login attempts on %s in the last 15 minutes.', r.cnt, r.email_key),
      jsonb_build_object('email', r.email_key, 'attempt_count', r.cnt, 'window_minutes', 15)
    ) THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT lower(trim(l.ip_address)) AS ip_key, COUNT(*)::INT AS cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - v_window
      AND NULLIF(trim(l.ip_address), '') IS NOT NULL
    GROUP BY lower(trim(l.ip_address))
    HAVING COUNT(*) >= 5
  LOOP
    IF public.notify_platform_admins_security_alert(
      'brute_force_ip',
      'ip:' || r.ip_key || ':' || v_bucket::text,
      'Possible brute-force from IP',
      format('%s failed login attempts from IP %s in the last 15 minutes.', r.cnt, r.ip_key),
      jsonb_build_object('ip_address', r.ip_key, 'attempt_count', r.cnt, 'window_minutes', 15)
    ) THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT lower(trim(l.ip_address)) AS ip_key, COUNT(DISTINCT lower(trim(l.target_email)))::INT AS email_cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - v_window
      AND NULLIF(trim(l.ip_address), '') IS NOT NULL
      AND NULLIF(trim(l.target_email), '') IS NOT NULL
    GROUP BY lower(trim(l.ip_address))
    HAVING COUNT(DISTINCT lower(trim(l.target_email))) >= 3
  LOOP
    IF public.notify_platform_admins_security_alert(
      'ip_scan',
      'ipscan:' || r.ip_key || ':' || v_bucket::text,
      'Possible credential scanning',
      format(
        'IP %s tried %s different email addresses in the last 15 minutes.',
        r.ip_key,
        r.email_cnt
      ),
      jsonb_build_object('ip_address', r.ip_key, 'distinct_emails', r.email_cnt, 'window_minutes', 15)
    ) THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.process_brute_force_anomaly_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_brute_force_anomaly_alerts() TO service_role;

CREATE OR REPLACE FUNCTION public.list_brute_force_anomalies(p_hours INT DEFAULT 24) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours INT := LEAST(GREATEST(COALESCE(p_hours, 24), 1), 168);
  v_email jsonb;
  v_ip jsonb;
  v_scan jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY cnt DESC), '[]'::jsonb) INTO v_email
  FROM (
    SELECT jsonb_build_object(
      'type', 'email',
      'email', lower(trim(l.target_email)),
      'attempt_count', COUNT(*)::INT,
      'last_at', MAX(l.created_at),
      'sample_ips', (
        SELECT COALESCE(jsonb_agg(DISTINCT ip_val), '[]'::jsonb)
        FROM (
          SELECT NULLIF(trim(l2.ip_address), '') AS ip_val
          FROM public.platform_audit_log l2
          WHERE l2.category = 'auth'
            AND l2.action = 'login_failed'
            AND lower(trim(l2.target_email)) = lower(trim(l.target_email))
            AND l2.created_at >= now() - make_interval(hours => v_hours)
            AND NULLIF(trim(l2.ip_address), '') IS NOT NULL
          LIMIT 5
        ) ips
      )
    ) AS x,
    COUNT(*)::INT AS cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - make_interval(hours => v_hours)
      AND NULLIF(trim(l.target_email), '') IS NOT NULL
    GROUP BY lower(trim(l.target_email))
    HAVING COUNT(*) >= 3
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY cnt DESC), '[]'::jsonb) INTO v_ip
  FROM (
    SELECT jsonb_build_object(
      'type', 'ip',
      'ip_address', lower(trim(l.ip_address)),
      'attempt_count', COUNT(*)::INT,
      'distinct_emails', COUNT(DISTINCT lower(trim(l.target_email)))::INT,
      'last_at', MAX(l.created_at)
    ) AS x,
    COUNT(*)::INT AS cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - make_interval(hours => v_hours)
      AND NULLIF(trim(l.ip_address), '') IS NOT NULL
    GROUP BY lower(trim(l.ip_address))
    HAVING COUNT(*) >= 3
  ) q2;

  SELECT COALESCE(jsonb_agg(x ORDER BY email_cnt DESC), '[]'::jsonb) INTO v_scan
  FROM (
    SELECT jsonb_build_object(
      'type', 'ip_scan',
      'ip_address', lower(trim(l.ip_address)),
      'distinct_emails', COUNT(DISTINCT lower(trim(l.target_email)))::INT,
      'attempt_count', COUNT(*)::INT,
      'last_at', MAX(l.created_at)
    ) AS x,
    COUNT(DISTINCT lower(trim(l.target_email)))::INT AS email_cnt
    FROM public.platform_audit_log l
    WHERE l.category = 'auth'
      AND l.action = 'login_failed'
      AND l.created_at >= now() - make_interval(hours => v_hours)
      AND NULLIF(trim(l.ip_address), '') IS NOT NULL
      AND NULLIF(trim(l.target_email), '') IS NOT NULL
    GROUP BY lower(trim(l.ip_address))
    HAVING COUNT(DISTINCT lower(trim(l.target_email))) >= 2
  ) q3;

  RETURN jsonb_build_object(
    'hours', v_hours,
    'email_targets', v_email,
    'ip_targets', v_ip,
    'ip_scans', v_scan,
    'alert_count_24h', (
      SELECT COUNT(*)::INT FROM public.platform_security_alert_dedupe d
      WHERE d.sent_at >= now() - interval '24 hours'
        AND d.alert_type IN ('brute_force_email', 'brute_force_ip', 'ip_scan')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_brute_force_anomalies(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_brute_force_anomalies(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_safety_overview(p_limit INT DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_reports jsonb;
  v_blocks jsonb;
  v_repeat jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT jsonb_build_object(
      'report_id', ur.id,
      'reason', ur.reason,
      'details', ur.details,
      'created_at', ur.created_at,
      'event_id', ur.event_id,
      'event_name', coalesce(e.name, ''),
      'reporter_email', coalesce(ru.email, ''),
      'reporter_name', coalesce(ru.full_name, ''),
      'reported_email', coalesce(uu.email, ''),
      'reported_name', coalesce(uu.full_name, ''),
      'reported_user_id', ur.reported_user_id
    ) AS x,
    ur.created_at AS ord
    FROM public.user_reports ur
    LEFT JOIN public.users ru ON ru.id = ur.reporter_id
    LEFT JOIN public.users uu ON uu.id = ur.reported_user_id
    LEFT JOIN public.events e ON e.id = ur.event_id
    ORDER BY ur.created_at DESC
    LIMIT v_limit
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_blocks
  FROM (
    SELECT jsonb_build_object(
      'block_id', bu.id,
      'created_at', bu.created_at,
      'blocker_email', coalesce(bku.email, ''),
      'blocker_name', coalesce(bku.full_name, ''),
      'blocked_email', coalesce(ubd.email, ''),
      'blocked_name', coalesce(ubd.full_name, ''),
      'blocked_user_id', bu.blocked_user_id
    ) AS x,
    bu.created_at AS ord
    FROM public.blocked_users bu
    LEFT JOIN public.users bku ON bku.id = bu.blocker_id
    LEFT JOIN public.users ubd ON ubd.id = bu.blocked_user_id
    ORDER BY bu.created_at DESC
    LIMIT v_limit
  ) q2;

  SELECT COALESCE(jsonb_agg(x ORDER BY report_count DESC), '[]'::jsonb) INTO v_repeat
  FROM (
    SELECT jsonb_build_object(
      'user_id', uu.id,
      'email', coalesce(uu.email, ''),
      'full_name', coalesce(uu.full_name, ''),
      'report_count', COUNT(*)::INT,
      'last_report_at', MAX(ur.created_at),
      'reasons', (
        SELECT COALESCE(jsonb_agg(DISTINCT ur2.reason), '[]'::jsonb)
        FROM public.user_reports ur2
        WHERE ur2.reported_user_id = uu.id
      )
    ) AS x,
    COUNT(*)::INT AS report_count
    FROM public.user_reports ur
    INNER JOIN public.users uu ON uu.id = ur.reported_user_id
    GROUP BY uu.id, uu.email, uu.full_name
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT v_limit
  ) q3;

  RETURN jsonb_build_object(
    'counts', jsonb_build_object(
      'total_reports', (SELECT COUNT(*)::INT FROM public.user_reports),
      'reports_7d', (
        SELECT COUNT(*)::INT FROM public.user_reports WHERE created_at >= now() - interval '7 days'
      ),
      'total_blocks', (SELECT COUNT(*)::INT FROM public.blocked_users),
      'blocks_7d', (
        SELECT COUNT(*)::INT FROM public.blocked_users WHERE created_at >= now() - interval '7 days'
      ),
      'repeat_offenders', (
        SELECT COUNT(*)::INT FROM (
          SELECT ur.reported_user_id
          FROM public.user_reports ur
          GROUP BY ur.reported_user_id
          HAVING COUNT(*) >= 2
        ) t
      )
    ),
    'reports', v_reports,
    'blocks', v_blocks,
    'repeat_offenders', v_repeat
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_safety_overview(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_safety_overview(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_suspicious_users(
  p_limit INT DEFAULT 50,
  p_min_score INT DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_min INT := GREATEST(COALESCE(p_min_score, 20), 0);
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY score DESC, ord DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'full_name', coalesce(u.full_name, ''),
      'created_at', u.created_at,
      'last_login_at', u.last_login_at,
      'is_active', u.is_active IS DISTINCT FROM false,
      'score', (
        (CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
        ) AND u.is_platform_admin IS DISTINCT FROM true THEN 20 ELSE 0 END)
        + LEAST(COALESCE(rpt.cnt, 0) * 15, 45)
        + LEAST(COALESCE(blk.cnt, 0) * 10, 30)
        + (CASE WHEN COALESCE(fl.cnt, 0) >= 5 THEN 15 ELSE 0 END)
        + (CASE WHEN u.is_active = false AND COALESCE(fl.cnt, 0) > 0 THEN 25 ELSE 0 END)
        + (CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
        ) AND u.is_platform_admin IS DISTINCT FROM true
          AND u.last_login_at >= now() - interval '7 days' THEN 10 ELSE 0 END)
      ),
      'signals', (
        SELECT COALESCE(jsonb_agg(sig ORDER BY sig), '[]'::jsonb)
        FROM (
          SELECT 'orphan_account'::text AS sig
          WHERE NOT EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = u.id)
            AND u.is_platform_admin IS DISTINCT FROM true
          UNION ALL
          SELECT format('reported_%s_times', rpt.cnt)
          WHERE COALESCE(rpt.cnt, 0) > 0
          UNION ALL
          SELECT format('blocked_by_%s_users', blk.cnt)
          WHERE COALESCE(blk.cnt, 0) > 0
          UNION ALL
          SELECT 'many_failed_logins'
          WHERE COALESCE(fl.cnt, 0) >= 5
          UNION ALL
          SELECT 'deactivated_login_attempts'
          WHERE u.is_active = false AND COALESCE(fl.cnt, 0) > 0
          UNION ALL
          SELECT 'orphan_recent_login'
          WHERE NOT EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = u.id)
            AND u.is_platform_admin IS DISTINCT FROM true
            AND u.last_login_at >= now() - interval '7 days'
        ) sig_rows
      ),
      'report_count', COALESCE(rpt.cnt, 0),
      'block_count', COALESCE(blk.cnt, 0),
      'failed_logins_7d', COALESCE(fl.cnt, 0)
    ) AS x,
    (
      (CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
      ) AND u.is_platform_admin IS DISTINCT FROM true THEN 20 ELSE 0 END)
      + LEAST(COALESCE(rpt.cnt, 0) * 15, 45)
      + LEAST(COALESCE(blk.cnt, 0) * 10, 30)
      + (CASE WHEN COALESCE(fl.cnt, 0) >= 5 THEN 15 ELSE 0 END)
      + (CASE WHEN u.is_active = false AND COALESCE(fl.cnt, 0) > 0 THEN 25 ELSE 0 END)
      + (CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
      ) AND u.is_platform_admin IS DISTINCT FROM true
        AND u.last_login_at >= now() - interval '7 days' THEN 10 ELSE 0 END)
    ) AS score,
    u.created_at AS ord
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS cnt
      FROM public.user_reports ur
      WHERE ur.reported_user_id = u.id
    ) rpt ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS cnt
      FROM public.blocked_users bu
      WHERE bu.blocked_user_id = u.id
    ) blk ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INT AS cnt
      FROM public.platform_audit_log l
      WHERE l.category = 'auth'
        AND l.action = 'login_failed'
        AND l.created_at >= now() - interval '7 days'
        AND (
          l.target_user_id = u.id
          OR lower(trim(l.target_email)) = lower(trim(u.email))
        )
    ) fl ON true
    WHERE u.is_platform_admin IS DISTINCT FROM true
  ) scored
  WHERE score >= v_min
  LIMIT v_limit;

  RETURN jsonb_build_object(
    'min_score', v_min,
    'rows', v_rows,
    'count', jsonb_array_length(v_rows)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_suspicious_users(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_suspicious_users(INT, INT) TO authenticated;

-- Extend security overview counts
CREATE OR REPLACE FUNCTION public.get_platform_security_overview() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphans jsonb;
  v_platform_admins jsonb;
  v_recent_signups jsonb;
  v_suspicious_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*)::INT INTO v_suspicious_count
  FROM (
    SELECT u.id,
      (
        (CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
        ) AND u.is_platform_admin IS DISTINCT FROM true THEN 20 ELSE 0 END)
        + LEAST((
          SELECT COUNT(*)::INT FROM public.user_reports ur WHERE ur.reported_user_id = u.id
        ) * 15, 45)
        + LEAST((
          SELECT COUNT(*)::INT FROM public.blocked_users bu WHERE bu.blocked_user_id = u.id
        ) * 10, 30)
        + (CASE WHEN (
          SELECT COUNT(*) FROM public.platform_audit_log l
          WHERE l.category = 'auth' AND l.action = 'login_failed'
            AND l.created_at >= now() - interval '7 days'
            AND (l.target_user_id = u.id OR lower(trim(l.target_email)) = lower(trim(u.email)))
        ) >= 5 THEN 15 ELSE 0 END)
        + (CASE WHEN u.is_active = false AND EXISTS (
          SELECT 1 FROM public.platform_audit_log l
          WHERE l.category = 'auth' AND l.action = 'login_failed'
            AND l.created_at >= now() - interval '7 days'
            AND (l.target_user_id = u.id OR lower(trim(l.target_email)) = lower(trim(u.email)))
        ) THEN 25 ELSE 0 END)
        + (CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
        ) AND u.is_platform_admin IS DISTINCT FROM true
          AND u.last_login_at >= now() - interval '7 days' THEN 10 ELSE 0 END)
      ) AS score
    FROM public.users u
    WHERE u.is_platform_admin IS DISTINCT FROM true
  ) s
  WHERE s.score >= 20;

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

-- Extend tile detail for new drill-downs
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
    v_pack := public.list_suspicious_users(v_limit, 20);
    RETURN jsonb_build_object(
      'tile', p_tile,
      'title', 'Suspicious users (score ≥ 20)',
      'rows', COALESCE(v_pack->'rows', '[]'::jsonb)
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

  -- existing tiles (unchanged branches)
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
