-- Wire solution categories into scoring and expose admin ranking RPC.

-- Sync multi_select answers → event_registration_solution_categories (auto-seed categories).
CREATE OR REPLACE FUNCTION public.sync_submission_solution_categories(p_submission_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.event_registration_submissions%ROWTYPE;
  v_cat_id UUID;
  v_label TEXT;
  v_linked INT := 0;
  v_answer RECORD;
BEGIN
  SELECT * INTO v_sub FROM public.event_registration_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF NOT (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(v_sub.event_id)
    OR v_sub.user_id = (SELECT auth.uid())
    OR public.registration_submission_owned_by_auth(p_submission_id)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.event_registration_solution_categories WHERE submission_id = p_submission_id;

  FOR v_answer IN
    SELECT q.question_type, a.answer_json
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_submission_id
      AND q.question_type = 'multi_select'
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
  LOOP
    FOR v_label IN SELECT jsonb_array_elements_text(v_answer.answer_json)
    LOOP
      v_label := trim(v_label);
      IF v_label = '' OR lower(v_label) = 'n/a' THEN CONTINUE; END IF;

      SELECT id INTO v_cat_id
      FROM public.event_solution_categories
      WHERE event_id = v_sub.event_id
        AND lower(trim(category_name)) = lower(v_label)
      LIMIT 1;

      IF v_cat_id IS NULL THEN
        INSERT INTO public.event_solution_categories (event_id, category_name, display_order)
        VALUES (
          v_sub.event_id,
          v_label,
          COALESCE((SELECT MAX(display_order) + 1 FROM public.event_solution_categories WHERE event_id = v_sub.event_id), 0)
        )
        ON CONFLICT (event_id, category_name) DO UPDATE SET updated_at = now()
        RETURNING id INTO v_cat_id;
      END IF;

      INSERT INTO public.event_registration_solution_categories (submission_id, category_id)
      VALUES (p_submission_id, v_cat_id)
      ON CONFLICT DO NOTHING;

      v_linked := v_linked + 1;
    END LOOP;
  END LOOP;

  RETURN v_linked;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_submission_solution_categories(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_submission_solution_categories(UUID) TO authenticated, service_role;

-- Answer helper: normalized text for a submission + prompt pattern.
CREATE OR REPLACE FUNCTION public.submission_answer_text(
  p_submission_id UUID,
  p_prompt_pattern TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(trim(a.answer_text), ''),
    CASE
      WHEN a.answer_json IS NOT NULL AND jsonb_typeof(a.answer_json) = 'array'
        THEN array_to_string(ARRAY(SELECT jsonb_array_elements_text(a.answer_json)), ', ')
      WHEN a.answer_json IS NOT NULL
        THEN trim(both '"' FROM a.answer_json::text)
      ELSE NULL
    END
  )
  FROM public.event_registration_answers a
  JOIN public.event_registration_questions q ON q.id = a.question_id
  JOIN public.event_registration_submissions s ON s.id = a.submission_id
  WHERE a.submission_id = p_submission_id
    AND q.prompt ~* p_prompt_pattern
  ORDER BY q.sort_order
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.submission_answer_text(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submission_answer_text(UUID, TEXT) TO authenticated, service_role;

-- Structured match scoring v1.1 — category join + weighted dimensions.
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
  v_from_rev TEXT;
  v_to_rev TEXT;
  v_from_budget TEXT;
  v_to_budget TEXT;
  v_from_scope TEXT;
  v_to_scope TEXT;
  v_from_csuite TEXT;
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

  -- used_in_matching multi_select overlap (non-category answers)
  SELECT COUNT(DISTINCT fa.val)::INT INTO v_ms_overlap
  FROM (
    SELECT jsonb_array_elements_text(a.answer_json) AS val
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_from_submission_id
      AND q.used_in_matching = true
      AND q.question_type = 'multi_select'
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
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
  ) tb ON lower(trim(tb.val)) = lower(trim(fa.val))
  WHERE lower(trim(fa.val)) NOT IN ('n/a', '');

  IF v_ms_overlap > 0 THEN
    v_total := v_total + LEAST(v_cfg.weight_goals, v_ms_overlap * 4);
  END IF;

  -- Goals: shared significant tokens in used_in_matching textarea answers
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
    v_total := v_total + LEAST(v_cfg.weight_goals, v_goals_overlap * 2);
  END IF;

  -- Seniority: delegate/decision-maker signal
  v_from_csuite := public.submission_answer_text(p_from_submission_id, 'c-suite');
  IF v_from_csuite IS NULL THEN
    v_from_csuite := public.submission_answer_text(p_to_submission_id, 'c-suite');
  END IF;
  IF lower(COALESCE(v_from_csuite, '')) = 'yes' THEN
    v_total := v_total + (v_cfg.weight_seniority / 2);
  END IF;

  -- Revenue / budget / scope alignment
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

  -- Interest request company name boost
  IF EXISTS (
    SELECT 1
    FROM public.event_meeting_interest_requests r
    JOIN public.event_registration_submissions cand ON cand.id = p_to_submission_id
    WHERE r.submission_id = p_from_submission_id
      AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE(cand.company_name, '')))
      AND trim(COALESCE(r.target_company_name, '')) <> ''
  ) OR EXISTS (
    SELECT 1
    FROM public.event_meeting_interest_requests r
    JOIN public.event_registration_submissions cand ON cand.id = p_from_submission_id
    WHERE r.submission_id = p_to_submission_id
      AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE(cand.company_name, '')))
      AND trim(COALESCE(r.target_company_name, '')) <> ''
  ) THEN
    v_total := v_total + 20;
  END IF;

  RETURN v_total;
END;
$$;

-- Admin: rank candidates for a selected submission using server-side scoring.
CREATE OR REPLACE FUNCTION public.rank_submission_matches(
  p_event_id UUID,
  p_submission_id UUID,
  p_limit INT DEFAULT 12
)
RETURNS TABLE (
  candidate_id UUID,
  score INT,
  category_overlap INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH source AS (
    SELECT attendee_type
    FROM public.event_registration_submissions
    WHERE id = p_submission_id
  ),
  candidates AS (
    SELECT s.id
    FROM public.event_registration_submissions s
    CROSS JOIN source src
    WHERE s.event_id = p_event_id
      AND s.id <> p_submission_id
      AND s.attendee_type = CASE WHEN src.attendee_type = 'vendor' THEN 'attendee' ELSE 'vendor' END
      AND s.status = 'submitted'
      AND s.registration_status = 'approved'
      AND s.rejected_at IS NULL
  )
  SELECT
    c.id AS candidate_id,
    public.compute_match_score(p_event_id, p_submission_id, c.id) AS score,
    (
      SELECT COUNT(*)::INT
      FROM public.event_registration_solution_categories a
      JOIN public.event_registration_solution_categories b ON b.category_id = a.category_id
      WHERE a.submission_id = p_submission_id
        AND b.submission_id = c.id
    ) AS category_overlap
  FROM candidates c
  WHERE public.is_event_admin(p_event_id) OR public.is_platform_admin((SELECT auth.uid()))
  ORDER BY score DESC, category_overlap DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.rank_submission_matches(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rank_submission_matches(UUID, UUID, INT) TO authenticated, service_role;
