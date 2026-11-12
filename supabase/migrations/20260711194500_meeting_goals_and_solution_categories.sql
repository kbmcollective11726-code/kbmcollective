-- TASK 2: Meeting Goals → single-select paired options + positional scoring
-- TASK 3: Replace default solution category starter list (cross-vertical)

DO $$
DECLARE
  r RECORD;
  v_qid UUID;
  v_delegate_opts TEXT[] := ARRAY[
    'Ready to evaluate and purchase solutions',
    'Researching for a future budget cycle',
    'Open to learning about new vendors',
    'Exploring strategic partnerships',
    'Building my network',
    'Sharing my organization''s expertise'
  ];
  v_vendor_opts TEXT[] := ARRAY[
    'Close deals with buyers ready to purchase',
    'Nurture prospects for a future sale',
    'Build brand awareness with new contacts',
    'Explore strategic partnerships',
    'Build my network',
    'Recruit partners or affiliates'
  ];
  v_new_cats TEXT[] := ARRAY[
    'Technology & Software',
    'Marketing & Communications',
    'Financial Services & Consulting',
    'Talent, HR & Workforce Solutions',
    'Sales & Customer Experience',
    'Legal, Risk & Compliance',
    'Operations & Supply Chain',
    'Leadership & Professional Development',
    'Sustainability & ESG',
    'Event & Meeting Services'
  ];
  v_legacy_cats TEXT[] := ARRAY[
    'Technologies',
    'Learning & Development',
    'Culture & Engagement',
    'Talent Acquisition',
    'HR Software',
    'Coaching',
    'Consulting',
    'Compensation & Benefits',
    'Organizational Culture',
    'Workforce & Leadership',
    'Executive Leadership',
    'Corporate Wellness'
  ];
  v_event RECORD;
  v_i INT;
  v_opt TEXT;
BEGIN
  -- Meeting Goals: delegate
  FOR r IN
    SELECT q.id AS question_id
    FROM public.event_registration_questions q
    JOIN public.event_registration_forms f ON f.id = q.form_id
    WHERE f.audience = 'attendee'
      AND lower(trim(q.prompt)) = lower('Meeting Goals')
  LOOP
    UPDATE public.event_registration_questions
    SET question_type = 'single_select',
        is_required = true,
        used_in_matching = true,
        is_base_question = true,
        is_hidden = false,
        updated_at = now()
    WHERE id = r.question_id;

    DELETE FROM public.event_registration_question_options WHERE question_id = r.question_id;
    FOR v_i IN 1 .. array_length(v_delegate_opts, 1) LOOP
      v_opt := v_delegate_opts[v_i];
      INSERT INTO public.event_registration_question_options (question_id, label, value, sort_order)
      VALUES (r.question_id, v_opt, v_opt, v_i - 1);
    END LOOP;
  END LOOP;

  -- Meeting Goals: vendor
  FOR r IN
    SELECT q.id AS question_id
    FROM public.event_registration_questions q
    JOIN public.event_registration_forms f ON f.id = q.form_id
    WHERE f.audience = 'vendor'
      AND lower(trim(q.prompt)) = lower('Meeting Goals')
  LOOP
    UPDATE public.event_registration_questions
    SET question_type = 'single_select',
        is_required = true,
        used_in_matching = true,
        is_base_question = true,
        is_hidden = false,
        updated_at = now()
    WHERE id = r.question_id;

    DELETE FROM public.event_registration_question_options WHERE question_id = r.question_id;
    FOR v_i IN 1 .. array_length(v_vendor_opts, 1) LOOP
      v_opt := v_vendor_opts[v_i];
      INSERT INTO public.event_registration_question_options (question_id, label, value, sort_order)
      VALUES (r.question_id, v_opt, v_opt, v_i - 1);
    END LOOP;
  END LOOP;

  -- Solution categories: hide legacy defaults, seed new defaults per event
  FOR v_event IN SELECT DISTINCT event_id FROM public.event_solution_categories
  LOOP
    UPDATE public.event_solution_categories
    SET is_hidden = true, is_default = true, updated_at = now()
    WHERE event_id = v_event.event_id
      AND category_name = ANY (v_legacy_cats);

    FOR v_i IN 1 .. array_length(v_new_cats, 1) LOOP
      INSERT INTO public.event_solution_categories (
        event_id, category_name, display_order, is_default, is_hidden
      )
      VALUES (v_event.event_id, v_new_cats[v_i], v_i - 1, true, false)
      ON CONFLICT (event_id, category_name) DO UPDATE
      SET display_order = EXCLUDED.display_order,
          is_default = true,
          is_hidden = false,
          updated_at = now();
    END LOOP;
  END LOOP;

  -- Also seed new categories for events that have forms but zero categories yet
  FOR v_event IN
    SELECT DISTINCT f.event_id
    FROM public.event_registration_forms f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_solution_categories c WHERE c.event_id = f.event_id
    )
  LOOP
    FOR v_i IN 1 .. array_length(v_new_cats, 1) LOOP
      INSERT INTO public.event_solution_categories (
        event_id, category_name, display_order, is_default, is_hidden
      )
      VALUES (v_event.event_id, v_new_cats[v_i], v_i - 1, true, false)
      ON CONFLICT (event_id, category_name) DO NOTHING;
    END LOOP;
  END LOOP;
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

  -- Other used_in_matching multi_select overlap (exclude Meeting Goals — now single-select paired)
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

  -- Meeting Goals positional pairing (delegate ↔ vendor)
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
          -- Weaker conceptual pair (Sharing expertise ↔ Recruit partners)
          v_total := v_total + GREATEST(1, v_cfg.weight_goals / 3);
        ELSE
          v_total := v_total + v_cfg.weight_goals;
        END IF;
      END IF;
    END IF;
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
    v_total := v_total + LEAST(v_cfg.weight_semantic, v_goals_overlap * 2);
  END IF;

  -- Seniority: delegate Seniority Level overlaps vendor hoped seniority levels
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
