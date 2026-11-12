-- Replace delegate C-suite Yes/No with Seniority Level (aligned to vendor target seniority).
-- Update match scoring to compare delegate level against vendor hoped levels.

DO $$
DECLARE
  r RECORD;
  v_qid UUID;
BEGIN
  FOR r IN
    SELECT q.id AS question_id, q.form_id
    FROM public.event_registration_questions q
    JOIN public.event_registration_forms f ON f.id = q.form_id
    WHERE f.audience = 'attendee'
      AND lower(trim(q.prompt)) = lower('I sit in the C-suite or report directly to the C-suite')
  LOOP
    -- Skip if Seniority Level already exists on this form
    IF EXISTS (
      SELECT 1 FROM public.event_registration_questions q2
      WHERE q2.form_id = r.form_id
        AND lower(trim(q2.prompt)) = lower('Seniority Level')
    ) THEN
      UPDATE public.event_registration_questions
      SET is_hidden = true, used_in_matching = false, updated_at = now()
      WHERE id = r.question_id;
      CONTINUE;
    END IF;

    UPDATE public.event_registration_questions
    SET
      prompt = 'Seniority Level',
      question_type = 'single_select',
      is_required = true,
      used_in_matching = true,
      is_base_question = true,
      is_hidden = false,
      updated_at = now()
    WHERE id = r.question_id;

    v_qid := r.question_id;
    DELETE FROM public.event_registration_question_options WHERE question_id = v_qid;
    INSERT INTO public.event_registration_question_options (question_id, label, value, sort_order)
    VALUES
      (v_qid, 'C-Suite', 'C-Suite', 0),
      (v_qid, 'SVP/VP', 'SVP/VP', 1),
      (v_qid, 'Director', 'Director', 2),
      (v_qid, 'Manager', 'Manager', 3),
      (v_qid, 'Individual Contributor', 'Individual Contributor', 4);
  END LOOP;

  -- Ensure "Name of person I report to" stays optional and out of scoring.
  UPDATE public.event_registration_questions q
  SET is_required = false, used_in_matching = false, updated_at = now()
  FROM public.event_registration_forms f
  WHERE q.form_id = f.id
    AND f.audience = 'attendee'
    AND lower(trim(q.prompt)) = lower('Name of person I report to');

  -- Ensure vendor target-seniority stays in matching with the shared option set.
  UPDATE public.event_registration_questions q
  SET used_in_matching = true, is_required = true, updated_at = now()
  FROM public.event_registration_forms f
  WHERE q.form_id = f.id
    AND f.audience = 'vendor'
    AND lower(trim(q.prompt)) = lower('Which seniority levels are you hoping to meet with?');
END $$;

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
  v_delegate_level TEXT;
  v_vendor_submission_id UUID;
  v_interest_boost INT := 0;
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

  -- Seniority: delegate "Seniority Level" overlaps vendor "Which seniority levels are you hoping to meet with?"
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
