-- Meeting requests: target profiles, interest levels, browse RPCs, smarter scoring.

ALTER TABLE public.event_meeting_interest_requests
  ADD COLUMN IF NOT EXISTS target_submission_id UUID REFERENCES public.event_registration_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interest_level TEXT;

ALTER TABLE public.event_meeting_interest_requests
  DROP CONSTRAINT IF EXISTS event_meeting_interest_requests_interest_level_check;

ALTER TABLE public.event_meeting_interest_requests
  ADD CONSTRAINT event_meeting_interest_requests_interest_level_check
  CHECK (interest_level IS NULL OR interest_level IN ('low', 'medium', 'high'));

CREATE UNIQUE INDEX IF NOT EXISTS event_meeting_interest_requests_unique_target
  ON public.event_meeting_interest_requests (submission_id, target_submission_id)
  WHERE target_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_meeting_request_caller(p_submission_id UUID)
RETURNS public.event_registration_submissions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_registration_submissions;
BEGIN
  SELECT s.*
  INTO v_row
  FROM public.event_registration_submissions s
  WHERE s.id = p_submission_id
    AND (
      public.is_platform_admin(auth.uid())
      OR public.is_event_admin(s.event_id)
      OR s.user_id = auth.uid()
      OR public.registration_submission_owned_by_auth(s.id)
    )
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  IF NOT public.is_event_meeting_requests_open(v_row.event_id) THEN
    RAISE EXCEPTION 'Meeting requests are not open for this event';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_meeting_request_caller(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_meeting_request_caller(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_meeting_request_targets(
  p_event_id UUID,
  p_submission_id UUID
)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  job_title TEXT,
  attendee_type TEXT,
  logo_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH source AS (
    SELECT public.assert_meeting_request_caller(p_submission_id) AS s
  )
  SELECT
    cand.id,
    cand.first_name,
    cand.last_name,
    cand.company_name,
    cand.job_title,
    cand.attendee_type,
    (
      SELECT a.answer_text
      FROM public.event_registration_answers a
      JOIN public.event_registration_questions q ON q.id = a.question_id
      WHERE a.submission_id = cand.id
        AND lower(trim(q.prompt)) IN ('company logo image', 'company logo url')
      ORDER BY a.updated_at DESC
      LIMIT 1
    ) AS logo_url
  FROM public.event_registration_submissions cand
  CROSS JOIN source src
  WHERE cand.event_id = p_event_id
    AND cand.id <> p_submission_id
    AND cand.status = 'submitted'
    AND cand.registration_status = 'approved'
    AND cand.profile_complete = true
    AND cand.attendee_type = CASE
      WHEN (src.s).attendee_type = 'vendor' THEN 'attendee'
      ELSE 'vendor'
    END
  ORDER BY cand.company_name NULLS LAST, cand.last_name NULLS LAST, cand.first_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.list_meeting_request_targets(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_meeting_request_targets(UUID, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_meeting_request_target_profile(
  p_event_id UUID,
  p_submission_id UUID,
  p_target_submission_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.event_registration_submissions;
  v_target public.event_registration_submissions;
  v_answers JSONB;
  v_categories JSONB;
BEGIN
  v_source := public.assert_meeting_request_caller(p_submission_id);

  SELECT s.*
  INTO v_target
  FROM public.event_registration_submissions s
  WHERE s.id = p_target_submission_id
    AND s.event_id = p_event_id
    AND s.status = 'submitted'
    AND s.registration_status = 'approved'
    AND s.profile_complete = true
    AND s.attendee_type = CASE
      WHEN v_source.attendee_type = 'vendor' THEN 'attendee'
      ELSE 'vendor'
    END
  LIMIT 1;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target profile not available';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'prompt', q.prompt,
    'section_label', q.section_label,
    'value', COALESCE(
      CASE
        WHEN a.answer_json IS NOT NULL AND jsonb_typeof(a.answer_json) = 'array'
          THEN (SELECT string_agg(elem, ', ' ORDER BY ord) FROM jsonb_array_elements_text(a.answer_json) WITH ORDINALITY AS t(elem, ord))
        WHEN a.answer_json IS NOT NULL THEN a.answer_json #>> '{}'
        WHEN a.answer_boolean IS NOT NULL THEN CASE WHEN a.answer_boolean THEN 'Yes' ELSE 'No' END
        WHEN a.answer_number IS NOT NULL THEN a.answer_number::TEXT
        ELSE a.answer_text
      END,
      ''
    )
  ) ORDER BY q.sort_order, q.created_at), '[]'::jsonb)
  INTO v_answers
  FROM public.event_registration_answers a
  JOIN public.event_registration_questions q ON q.id = a.question_id
  WHERE a.submission_id = v_target.id
    AND lower(trim(q.prompt)) NOT IN (
      'first name', 'last name', 'email', 'e-mail address', 'company name', 'job title', 'cell phone', 'password'
    );

  SELECT COALESCE(jsonb_agg(c.category_name ORDER BY c.display_order, c.category_name), '[]'::jsonb)
  INTO v_categories
  FROM public.event_registration_solution_categories sc
  JOIN public.event_solution_categories c ON c.id = sc.category_id
  WHERE sc.submission_id = v_target.id;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'first_name', v_target.first_name,
    'last_name', v_target.last_name,
    'company_name', v_target.company_name,
    'job_title', v_target.job_title,
    'attendee_type', v_target.attendee_type,
    'answers', v_answers,
    'categories', v_categories
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meeting_request_target_profile(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meeting_request_target_profile(UUID, UUID, UUID) TO anon, authenticated, service_role;

-- Smarter interest-request scoring: direct target match, interest level, and rank priority.
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

  v_from_csuite := public.submission_answer_text(p_from_submission_id, 'c-suite');
  IF v_from_csuite IS NULL THEN
    v_from_csuite := public.submission_answer_text(p_to_submission_id, 'c-suite');
  END IF;
  IF lower(COALESCE(v_from_csuite, '')) = 'yes' THEN
    v_total := v_total + (v_cfg.weight_seniority / 2);
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

  SELECT COALESCE(MAX(
    CASE COALESCE(r.interest_level, 'medium')
      WHEN 'high' THEN 30
      WHEN 'medium' THEN 20
      WHEN 'low' THEN 10
      ELSE 15
    END + GREATEST(0, 6 - LEAST(r.priority, 5))
  ), 0)
  INTO v_interest_boost
  FROM public.event_meeting_interest_requests r
  WHERE (
    (r.submission_id = p_from_submission_id AND (
      r.target_submission_id = p_to_submission_id
      OR (
        r.target_submission_id IS NULL
        AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE((
          SELECT company_name FROM public.event_registration_submissions WHERE id = p_to_submission_id
        ), '')))
        AND trim(COALESCE(r.target_company_name, '')) <> ''
      )
    ))
    OR (r.submission_id = p_to_submission_id AND (
      r.target_submission_id = p_from_submission_id
      OR (
        r.target_submission_id IS NULL
        AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE((
          SELECT company_name FROM public.event_registration_submissions WHERE id = p_from_submission_id
        ), '')))
        AND trim(COALESCE(r.target_company_name, '')) <> ''
      )
    ))
  );

  v_total := v_total + v_interest_boost;

  RETURN v_total;
END;
$$;
