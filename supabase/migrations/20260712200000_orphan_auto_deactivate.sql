-- Auto-deactivate orphan accounts that match the platform security policy:
-- no event membership, not platform admin, account age >= 14 days, still active, and
-- (no submitted portal registration OR >= 5 failed logins in 7 days).

CREATE OR REPLACE FUNCTION public.user_failed_logins_7d(p_user_id UUID, p_email TEXT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.platform_audit_log l
  WHERE l.category = 'auth'
    AND l.action = 'login_failed'
    AND l.created_at >= now() - interval '7 days'
    AND (
      l.target_user_id = p_user_id
      OR (
        p_email IS NOT NULL
        AND l.target_email IS NOT NULL
        AND lower(trim(l.target_email)) = lower(trim(p_email))
      )
    );
$$;

REVOKE ALL ON FUNCTION public.user_failed_logins_7d(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_failed_logins_7d(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.user_has_submitted_portal_registration(p_user_id UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.status = 'submitted'
      AND (
        s.user_id = p_user_id
        OR (
          p_email IS NOT NULL
          AND s.email IS NOT NULL
          AND lower(trim(s.email)) = lower(trim(p_email))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_submitted_portal_registration(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_submitted_portal_registration(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.process_orphan_account_auto_deactivations(
  p_min_account_age_days INT DEFAULT 14,
  p_failed_login_threshold INT DEFAULT 5,
  p_limit INT DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_age INT := GREATEST(COALESCE(p_min_account_age_days, 14), 1);
  v_failed_threshold INT := GREATEST(COALESCE(p_failed_login_threshold, 5), 1);
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_row RECORD;
  v_failed INT;
  v_has_submission BOOLEAN;
  v_reason TEXT;
  v_deactivated INT := 0;
  v_deactivated_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR v_row IN
    SELECT u.id, u.email, u.full_name, u.created_at
    FROM public.users u
    WHERE u.is_platform_admin IS DISTINCT FROM true
      AND u.is_active IS DISTINCT FROM false
      AND u.created_at < now() - make_interval(days => v_min_age)
      AND NOT EXISTS (
        SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
      )
    ORDER BY u.created_at ASC
    LIMIT v_limit * 3
  LOOP
    EXIT WHEN v_deactivated >= v_limit;

    v_has_submission := public.user_has_submitted_portal_registration(v_row.id, v_row.email);
    v_failed := public.user_failed_logins_7d(v_row.id, v_row.email);

    IF v_has_submission AND v_failed < v_failed_threshold THEN
      CONTINUE;
    END IF;

    IF NOT v_has_submission AND v_failed < v_failed_threshold THEN
      v_reason := 'no_event_membership_no_portal_submission';
    ELSIF NOT v_has_submission AND v_failed >= v_failed_threshold THEN
      v_reason := 'no_event_membership_no_portal_submission_and_failed_logins';
    ELSIF v_has_submission AND v_failed >= v_failed_threshold THEN
      v_reason := 'no_event_membership_failed_logins';
    ELSE
      v_reason := 'no_event_membership';
    END IF;

    UPDATE public.users
    SET is_active = false
    WHERE id = v_row.id
      AND is_active IS DISTINCT FROM false;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    PERFORM public.insert_platform_audit_log(
      'admin',
      'account_deactivate',
      NULL,
      v_row.id,
      v_row.email,
      COALESCE(NULLIF(trim(v_row.full_name), ''), v_row.email),
      NULL,
      NULL,
      jsonb_build_object(
        'source', 'auto_orphan_policy',
        'reason', v_reason,
        'min_account_age_days', v_min_age,
        'failed_logins_7d', v_failed,
        'has_submitted_portal_registration', v_has_submission,
        'summary',
          format(
            'Automated deactivation: %s — no event membership, account at least %s days old%s.',
            COALESCE(NULLIF(trim(v_row.full_name), ''), v_row.email),
            v_min_age,
            CASE
              WHEN NOT v_has_submission AND v_failed >= v_failed_threshold THEN
                ', no submitted portal registration, and ' || v_failed || ' failed logins in 7 days'
              WHEN NOT v_has_submission THEN
                ', no submitted portal registration'
              WHEN v_failed >= v_failed_threshold THEN
                ', and ' || v_failed || ' failed logins in 7 days'
              ELSE
                ''
            END
          )
      )
    );

    v_deactivated := v_deactivated + 1;
    v_deactivated_ids := array_append(v_deactivated_ids, v_row.id);
  END LOOP;

  RETURN jsonb_build_object(
    'deactivated', v_deactivated,
    'user_ids', to_jsonb(v_deactivated_ids),
    'min_account_age_days', v_min_age,
    'failed_login_threshold', v_failed_threshold
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_orphan_account_auto_deactivations(INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_orphan_account_auto_deactivations(INT, INT, INT) TO service_role;
