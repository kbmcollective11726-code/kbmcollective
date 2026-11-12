-- AI theme tags from open-text goals (Haiku extracts; SQL scores overlap).
-- Platform admin can enable/disable via platform_settings.match_ai_themes_enabled.
-- Falls back to shared-word overlap when themes are missing or AI is off.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value_bool BOOLEAN,
  value_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read platform_settings" ON public.platform_settings;
CREATE POLICY "Authenticated read platform_settings"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.platform_settings (key, value_bool)
VALUES ('match_ai_themes_enabled', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_match_ai_themes_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value_bool FROM public.platform_settings WHERE key = 'match_ai_themes_enabled'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.set_match_ai_themes_enabled(p_enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only platform admins can enable or disable AI match themes';
  END IF;

  INSERT INTO public.platform_settings (key, value_bool, updated_at, updated_by)
  VALUES ('match_ai_themes_enabled', COALESCE(p_enabled, false), now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value_bool = EXCLUDED.value_bool,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN COALESCE(p_enabled, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_match_ai_themes_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_match_ai_themes_enabled(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_match_ai_themes_enabled() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_match_ai_themes_enabled(BOOLEAN) TO authenticated, service_role;

ALTER TABLE public.event_registration_submissions
  ADD COLUMN IF NOT EXISTS match_themes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS match_themes_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_themes_source_hash TEXT;

COMMENT ON COLUMN public.event_registration_submissions.match_themes IS
  'Short theme tags extracted from open-text matching answers (Haiku). Used by compute_match_score when AI themes are enabled.';

CREATE OR REPLACE FUNCTION public.compute_match_score(
  p_event_id UUID,
  p_from_submission_id UUID,
  p_to_submission_id UUID
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_overlap INT := 0;
  v_cfg RECORD;
  v_total INT := 0;
  v_ms_overlap INT := 0;
  v_goals_overlap INT := 0;
  v_theme_overlap INT := 0;
  v_from_rev TEXT;
  v_to_rev TEXT;
  v_from_budget TEXT;
  v_to_budget TEXT;
  v_from_scope TEXT;
  v_to_scope TEXT;
  v_delegate_level TEXT;
  v_vendor_submission_id UUID;
  v_interest_boost INT := 0;
  v_from_type TEXT;
  v_to_type TEXT;
  v_delegate_id UUID;
  v_vendor_id UUID;
  v_delegate_goal TEXT;
  v_vendor_goal TEXT;
  v_delegate_goal_idx INT;
  v_vendor_goal_idx INT;
  v_delegate_goals TEXT[] := ARRAY[
    'Ready to evaluate and purchase solutions',
    'Researching for a future budget cycle',
    'Open to learning about new vendors',
    'Exploring strategic partnerships',
    'Building my network',
    'Sharing my organization''s expertise'
  ];
  v_vendor_goals TEXT[] := ARRAY[
    'Close deals with buyers ready to purchase',
    'Nurture prospects for a future sale',
    'Build brand awareness with new contacts',
    'Explore strategic partnerships',
    'Build my network',
    'Recruit partners or affiliates'
  ];
BEGIN
  SELECT * INTO v_cfg FROM public.event_match_config WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    v_cfg.weight_category := 40;
    v_cfg.weight_goals := 15;
    v_cfg.weight_seniority := 10;
    v_cfg.weight_revenue := 10;
    v_cfg.weight_budget := 10;
    v_cfg.weight_scope := 10;
    v_cfg.weight_semantic := 5;
  END IF;

  SELECT COUNT(*)::INT INTO v_cat_overlap
  FROM public.event_registration_solution_categories a
  JOIN public.event_registration_solution_categories b ON b.category_id = a.category_id
  WHERE a.submission_id = p_from_submission_id
    AND b.submission_id = p_to_submission_id;

  IF v_cat_overlap > 0 THEN
    v_total := v_total + LEAST(v_cfg.weight_category, v_cat_overlap * 8);
  END IF;

  SELECT COUNT(DISTINCT fa.val)::INT INTO v_ms_overlap
  FROM (
    SELECT jsonb_array_elements_text(a.answer_json) AS val
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_from_submission_id
      AND q.used_in_matching = true
      AND q.question_type = 'multi_select'
      AND lower(trim(q.prompt)) <> lower('Meeting Goals')
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
  ) fa
  JOIN (
    SELECT jsonb_array_elements_text(a.answer_json) AS val
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_to_submission_id
      AND q.used_in_matching = true
      AND q.question_type = 'multi_select'
      AND lower(trim(q.prompt)) <> lower('Meeting Goals')
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
  ) tb ON lower(trim(tb.val)) = lower(trim(fa.val))
  WHERE lower(trim(fa.val)) NOT IN ('n/a', '');

  IF v_ms_overlap > 0 THEN
    v_total := v_total + LEAST(v_cfg.weight_goals, v_ms_overlap * 4);
  END IF;

  SELECT attendee_type INTO v_from_type FROM public.event_registration_submissions WHERE id = p_from_submission_id;
  SELECT attendee_type INTO v_to_type FROM public.event_registration_submissions WHERE id = p_to_submission_id;

  IF v_from_type = 'attendee' AND v_to_type = 'vendor' THEN
    v_delegate_id := p_from_submission_id;
    v_vendor_id := p_to_submission_id;
  ELSIF v_from_type = 'vendor' AND v_to_type = 'attendee' THEN
    v_delegate_id := p_to_submission_id;
    v_vendor_id := p_from_submission_id;
  ELSE
    v_delegate_id := NULL;
    v_vendor_id := NULL;
  END IF;

  IF v_delegate_id IS NOT NULL AND v_vendor_id IS NOT NULL THEN
    v_delegate_goal := public.submission_answer_text(v_delegate_id, '^Meeting Goals$');
    v_vendor_goal := public.submission_answer_text(v_vendor_id, '^Meeting Goals$');
    IF v_delegate_goal IS NOT NULL AND v_vendor_goal IS NOT NULL THEN
      v_delegate_goal_idx := array_position(
        ARRAY(SELECT lower(trim(x)) FROM unnest(v_delegate_goals) AS x),
        lower(trim(v_delegate_goal))
      );
      v_vendor_goal_idx := array_position(
        ARRAY(SELECT lower(trim(x)) FROM unnest(v_vendor_goals) AS x),
        lower(trim(v_vendor_goal))
      );
      IF v_delegate_goal_idx IS NOT NULL AND v_vendor_goal_idx IS NOT NULL
         AND v_delegate_goal_idx = v_vendor_goal_idx THEN
        IF v_delegate_goal_idx = 6 THEN
          v_total := v_total + GREATEST(1, v_cfg.weight_goals / 3);
        ELSE
          v_total := v_total + v_cfg.weight_goals;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Prefer AI theme overlap for open-text; fall back to shared words when themes missing.
  SELECT COUNT(*)::INT INTO v_theme_overlap
  FROM (
    SELECT DISTINCT lower(trim(t)) AS theme
    FROM public.event_registration_submissions s
    CROSS JOIN LATERAL unnest(COALESCE(s.match_themes, '{}')) AS t
    WHERE s.id = p_from_submission_id
      AND length(trim(t)) >= 3
  ) a
  JOIN (
    SELECT DISTINCT lower(trim(t)) AS theme
    FROM public.event_registration_submissions s
    CROSS JOIN LATERAL unnest(COALESCE(s.match_themes, '{}')) AS t
    WHERE s.id = p_to_submission_id
      AND length(trim(t)) >= 3
  ) b ON b.theme = a.theme;

  IF v_theme_overlap > 0 THEN
    v_total := v_total + LEAST(v_cfg.weight_semantic, v_theme_overlap * 3);
  ELSE
    SELECT COUNT(*)::INT INTO v_goals_overlap
    FROM (
      SELECT DISTINCT lower(regexp_split_to_table(
        regexp_replace(COALESCE(a.answer_text, ''), '[^a-zA-Z0-9 ]', ' ', 'g'),
        '\s+'
      )) AS token
      FROM public.event_registration_answers a
      JOIN public.event_registration_questions q ON q.id = a.question_id
      WHERE a.submission_id = p_from_submission_id
        AND q.used_in_matching = true
        AND q.question_type = 'textarea'
        AND COALESCE(a.answer_text, '') <> ''
    ) ft
    JOIN (
      SELECT DISTINCT lower(regexp_split_to_table(
        regexp_replace(COALESCE(a.answer_text, ''), '[^a-zA-Z0-9 ]', ' ', 'g'),
        '\s+'
      )) AS token
      FROM public.event_registration_answers a
      JOIN public.event_registration_questions q ON q.id = a.question_id
      WHERE a.submission_id = p_to_submission_id
        AND q.used_in_matching = true
        AND q.question_type = 'textarea'
        AND COALESCE(a.answer_text, '') <> ''
    ) tt ON tt.token = ft.token
    WHERE length(ft.token) >= 5;

    IF v_goals_overlap > 0 THEN
      v_total := v_total + LEAST(v_cfg.weight_semantic, v_goals_overlap * 2);
    END IF;
  END IF;

  v_delegate_level := public.submission_answer_text(p_from_submission_id, '^Seniority Level$');
  IF v_delegate_level IS NOT NULL THEN
    v_vendor_submission_id := p_to_submission_id;
  ELSE
    v_delegate_level := public.submission_answer_text(p_to_submission_id, '^Seniority Level$');
    v_vendor_submission_id := p_from_submission_id;
  END IF;

  IF v_delegate_level IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = v_vendor_submission_id
      AND q.prompt ~* 'seniority levels are you hoping to meet'
      AND (
        (
          a.answer_json IS NOT NULL
          AND jsonb_typeof(a.answer_json) = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(a.answer_json) AS lev(val)
            WHERE lower(trim(lev.val)) = lower(trim(v_delegate_level))
          )
        )
        OR position(lower(trim(v_delegate_level)) IN lower(COALESCE(a.answer_text, ''))) > 0
      )
  ) THEN
    v_total := v_total + v_cfg.weight_seniority;
  END IF;

  v_from_rev := public.submission_answer_text(p_from_submission_id, 'annual revenue');
  v_to_rev := public.submission_answer_text(p_to_submission_id, 'annual revenue');
  IF v_from_rev IS NOT NULL AND v_to_rev IS NOT NULL AND lower(trim(v_from_rev)) = lower(trim(v_to_rev)) THEN
    v_total := v_total + v_cfg.weight_revenue;
  END IF;

  v_from_budget := public.submission_answer_text(p_from_submission_id, 'budget for external');
  v_to_budget := public.submission_answer_text(p_to_submission_id, 'budget for external');
  IF v_from_budget IS NOT NULL AND v_to_budget IS NOT NULL AND lower(trim(v_from_budget)) = lower(trim(v_to_budget)) THEN
    v_total := v_total + v_cfg.weight_budget;
  END IF;

  v_from_scope := public.submission_answer_text(p_from_submission_id, 'scope of responsibility');
  v_to_scope := public.submission_answer_text(p_to_submission_id, 'scope of responsibility');
  IF v_from_scope IS NOT NULL AND v_to_scope IS NOT NULL AND lower(trim(v_from_scope)) = lower(trim(v_to_scope)) THEN
    v_total := v_total + v_cfg.weight_scope;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_meeting_interest_requests r
    JOIN public.event_registration_submissions cand ON cand.id = p_to_submission_id
    WHERE r.submission_id = p_from_submission_id
      AND (
        (r.target_submission_id IS NOT NULL AND r.target_submission_id = p_to_submission_id)
        OR (
          r.target_submission_id IS NULL
          AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE(cand.company_name, '')))
          AND trim(COALESCE(r.target_company_name, '')) <> ''
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.event_meeting_interest_requests r
    JOIN public.event_registration_submissions cand ON cand.id = p_from_submission_id
    WHERE r.submission_id = p_to_submission_id
      AND (
        (r.target_submission_id IS NOT NULL AND r.target_submission_id = p_from_submission_id)
        OR (
          r.target_submission_id IS NULL
          AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE(cand.company_name, '')))
          AND trim(COALESCE(r.target_company_name, '')) <> ''
        )
      )
  ) THEN
    SELECT COALESCE(MAX(
      CASE lower(COALESCE(r.interest_level, 'medium'))
        WHEN 'high' THEN 28
        WHEN 'medium' THEN 20
        WHEN 'low' THEN 12
        ELSE 20
      END
      + GREATEST(0, 8 - LEAST(COALESCE(r.priority, 99), 8))
    ), 20)
    INTO v_interest_boost
    FROM public.event_meeting_interest_requests r
    WHERE (
      r.submission_id = p_from_submission_id
      AND (
        r.target_submission_id = p_to_submission_id
        OR (
          r.target_submission_id IS NULL
          AND lower(trim(COALESCE(r.target_company_name, ''))) = (
            SELECT lower(trim(COALESCE(company_name, '')))
            FROM public.event_registration_submissions
            WHERE id = p_to_submission_id
          )
        )
      )
    ) OR (
      r.submission_id = p_to_submission_id
      AND (
        r.target_submission_id = p_from_submission_id
        OR (
          r.target_submission_id IS NULL
          AND lower(trim(COALESCE(r.target_company_name, ''))) = (
            SELECT lower(trim(COALESCE(company_name, '')))
            FROM public.event_registration_submissions
            WHERE id = p_from_submission_id
          )
        )
      )
    );
    v_total := v_total + COALESCE(v_interest_boost, 20);
  END IF;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_match_score(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_match_score(UUID, UUID, UUID) TO authenticated, service_role;
