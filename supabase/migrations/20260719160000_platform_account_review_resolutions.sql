-- Allow platform admins to recognize legitimate orphan accounts and clear
-- reviewed risk signals without deleting immutable audit/security evidence.

CREATE TABLE IF NOT EXISTS public.platform_account_review_resolutions (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_recognized BOOLEAN NOT NULL DEFAULT false,
  risk_cleared_at TIMESTAMPTZ,
  note TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_account_review_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_account_review_resolutions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_account_review(
  p_user_id UUID,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT := lower(trim(COALESCE(p_action, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  IF v_action NOT IN ('recognize', 'clear_risk') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  INSERT INTO public.platform_account_review_resolutions (
    user_id,
    is_recognized,
    risk_cleared_at,
    note,
    reviewed_by,
    reviewed_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_action = 'recognize',
    now(),
    NULLIF(trim(COALESCE(p_note, '')), ''),
    auth.uid(),
    now(),
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    is_recognized = CASE
      WHEN v_action = 'recognize' THEN true
      ELSE platform_account_review_resolutions.is_recognized
    END,
    risk_cleared_at = now(),
    note = COALESCE(
      NULLIF(trim(COALESCE(p_note, '')), ''),
      platform_account_review_resolutions.note
    ),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_account_review(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_account_review(UUID, TEXT, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.clear_platform_account_review(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.platform_account_review_resolutions
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_platform_account_review(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_platform_account_review(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_platform_account_reviews(
  p_limit INT DEFAULT 50,
  p_min_score INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_min INT := GREATEST(COALESCE(p_min_score, 20), 0);
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  WITH base AS (
    SELECT
      u.id AS user_id,
      u.email,
      COALESCE(u.full_name, '') AS full_name,
      u.created_at,
      u.last_login_at,
      u.is_active IS DISTINCT FROM false AS is_active,
      u.is_platform_admin = true AS is_platform_admin,
      NOT EXISTS (
        SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
      ) AS is_orphan,
      COALESCE(rr.is_recognized, false) AS is_recognized,
      rr.risk_cleared_at,
      rr.note AS review_note,
      rr.reviewed_at,
      rr.reviewed_by,
      (
        SELECT count(*)::INT
        FROM public.user_reports ur
        WHERE ur.reported_user_id = u.id
          AND (rr.risk_cleared_at IS NULL OR ur.created_at > rr.risk_cleared_at)
      ) AS report_count,
      (
        SELECT count(*)::INT
        FROM public.blocked_users bu
        WHERE bu.blocked_user_id = u.id
          AND (rr.risk_cleared_at IS NULL OR bu.created_at > rr.risk_cleared_at)
      ) AS block_count,
      (
        SELECT count(*)::INT
        FROM public.platform_audit_log l
        WHERE l.category = 'auth'
          AND l.action = 'login_failed'
          AND l.created_at >= now() - interval '7 days'
          AND (rr.risk_cleared_at IS NULL OR l.created_at > rr.risk_cleared_at)
          AND (
            l.target_user_id = u.id
            OR lower(trim(l.target_email)) = lower(trim(u.email))
          )
      ) AS failed_logins_7d
    FROM public.users u
    LEFT JOIN public.platform_account_review_resolutions rr ON rr.user_id = u.id
    WHERE u.is_platform_admin IS DISTINCT FROM true
  ),
  scored AS (
    SELECT
      b.*,
      (
        CASE WHEN b.is_orphan AND NOT b.is_recognized THEN 20 ELSE 0 END
        + LEAST(b.report_count * 15, 45)
        + LEAST(b.block_count * 10, 30)
        + CASE WHEN b.failed_logins_7d >= 5 THEN 15 ELSE 0 END
        + CASE WHEN NOT b.is_active AND b.failed_logins_7d > 0 THEN 25 ELSE 0 END
        + CASE
            WHEN b.is_orphan
              AND NOT b.is_recognized
              AND b.last_login_at >= now() - interval '7 days'
            THEN 10
            ELSE 0
          END
      )::INT AS score
    FROM base b
  )
  SELECT jsonb_build_object(
    'min_score', v_min,
    'suspicious_count', (
      SELECT count(*)::INT FROM scored s WHERE s.score >= v_min
    ),
    'orphan_count', (
      SELECT count(*)::INT
      FROM scored s
      WHERE s.is_orphan AND NOT s.is_recognized
    ),
    'reviewed_count', (
      SELECT count(*)::INT
      FROM scored s
      WHERE s.is_recognized OR s.risk_cleared_at IS NOT NULL
    ),
    'suspicious_rows', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY score DESC, created_at DESC)
      FROM (
        SELECT
          jsonb_build_object(
            'user_id', s.user_id,
            'email', s.email,
            'full_name', s.full_name,
            'score', s.score,
            'signals', to_jsonb(ARRAY_REMOVE(ARRAY[
              CASE WHEN s.is_orphan AND NOT s.is_recognized THEN 'orphan_account' END,
              CASE WHEN s.report_count > 0 THEN format('reported_%s_times', s.report_count) END,
              CASE WHEN s.block_count > 0 THEN format('blocked_by_%s_users', s.block_count) END,
              CASE WHEN s.failed_logins_7d >= 5 THEN 'many_failed_logins' END,
              CASE WHEN NOT s.is_active AND s.failed_logins_7d > 0 THEN 'deactivated_login_attempts' END,
              CASE
                WHEN s.is_orphan AND NOT s.is_recognized
                  AND s.last_login_at >= now() - interval '7 days'
                THEN 'orphan_recent_login'
              END
            ], NULL)),
            'report_count', s.report_count,
            'block_count', s.block_count,
            'failed_logins_7d', s.failed_logins_7d,
            'is_active', s.is_active,
            'created_at', s.created_at,
            'last_login_at', s.last_login_at
          ) AS row_data,
          s.score,
          s.created_at
        FROM scored s
        WHERE s.score >= v_min
        ORDER BY s.score DESC, s.created_at DESC
        LIMIT v_limit
      ) q
    ), '[]'::jsonb),
    'orphan_rows', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY created_at DESC)
      FROM (
        SELECT
          jsonb_build_object(
            'user_id', s.user_id,
            'email', s.email,
            'full_name', s.full_name,
            'created_at', s.created_at,
            'last_login_at', s.last_login_at,
            'is_platform_admin', s.is_platform_admin,
            'is_active', s.is_active
          ) AS row_data,
          s.created_at
        FROM scored s
        WHERE s.is_orphan AND NOT s.is_recognized
        ORDER BY s.created_at DESC
        LIMIT v_limit
      ) q
    ), '[]'::jsonb),
    'reviewed_rows', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY reviewed_at DESC)
      FROM (
        SELECT
          jsonb_build_object(
            'user_id', s.user_id,
            'email', s.email,
            'full_name', s.full_name,
            'is_recognized', s.is_recognized,
            'risk_cleared_at', s.risk_cleared_at,
            'note', s.review_note,
            'reviewed_at', s.reviewed_at,
            'reviewed_by_email', reviewer.email
          ) AS row_data,
          s.reviewed_at
        FROM scored s
        LEFT JOIN public.users reviewer ON reviewer.id = s.reviewed_by
        WHERE s.is_recognized OR s.risk_cleared_at IS NOT NULL
        ORDER BY s.reviewed_at DESC
        LIMIT v_limit
      ) q
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_account_reviews(INT, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_account_reviews(INT, INT)
  TO authenticated, service_role;

