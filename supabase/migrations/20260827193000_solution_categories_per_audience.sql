-- Delegate and vendor solution category checklists are managed separately.
-- Matching still compares category names across audiences.

ALTER TABLE public.event_solution_categories
  ADD COLUMN IF NOT EXISTS audience TEXT;

UPDATE public.event_solution_categories
SET audience = 'attendee'
WHERE audience IS NULL OR trim(audience) = '';

ALTER TABLE public.event_solution_categories
  ALTER COLUMN audience SET DEFAULT 'attendee',
  ALTER COLUMN audience SET NOT NULL;

ALTER TABLE public.event_solution_categories
  DROP CONSTRAINT IF EXISTS event_solution_categories_name_unique;

ALTER TABLE public.event_solution_categories
  DROP CONSTRAINT IF EXISTS event_solution_categories_event_audience_name_unique;

ALTER TABLE public.event_solution_categories
  ADD CONSTRAINT event_solution_categories_audience_check
  CHECK (audience IN ('attendee', 'vendor'));

ALTER TABLE public.event_solution_categories
  ADD CONSTRAINT event_solution_categories_event_audience_name_unique
  UNIQUE (event_id, audience, category_name);

CREATE INDEX IF NOT EXISTS idx_event_solution_categories_event_audience
  ON public.event_solution_categories (event_id, audience, display_order);

COMMENT ON COLUMN public.event_solution_categories.audience IS
  'attendee = delegate interest checklist; vendor = vendor offerings checklist.';

-- Clone existing delegate categories to vendor so live events keep working.
INSERT INTO public.event_solution_categories (
  event_id, category_name, display_order, is_hidden, is_default, audience
)
SELECT
  d.event_id,
  d.category_name,
  d.display_order,
  d.is_hidden,
  d.is_default,
  'vendor'
FROM public.event_solution_categories d
WHERE d.audience = 'attendee'
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_solution_categories v
    WHERE v.event_id = d.event_id
      AND v.audience = 'vendor'
      AND lower(trim(v.category_name)) = lower(trim(d.category_name))
  );

CREATE OR REPLACE FUNCTION public.solution_category_overlap_count(
  p_submission_a UUID,
  p_submission_b UUID
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT lower(trim(ca.category_name)))::INT
  FROM public.event_registration_solution_categories a
  JOIN public.event_solution_categories ca ON ca.id = a.category_id
  JOIN public.event_registration_solution_categories b ON b.submission_id = p_submission_b
  JOIN public.event_solution_categories cb ON cb.id = b.category_id
    AND lower(trim(cb.category_name)) = lower(trim(ca.category_name))
  WHERE a.submission_id = p_submission_a;
$$;

REVOKE ALL ON FUNCTION public.solution_category_overlap_count(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solution_category_overlap_count(UUID, UUID) TO authenticated, service_role;

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
  v_audience TEXT;
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

  v_audience := CASE
    WHEN v_sub.attendee_type = 'vendor' THEN 'vendor'
    ELSE 'attendee'
  END;

  DELETE FROM public.event_registration_solution_categories WHERE submission_id = p_submission_id;

  FOR v_answer IN
    SELECT q.question_type, a.answer_json
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_submission_id
      AND q.question_type = 'multi_select'
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
      AND lower(trim(q.prompt)) IN (
        lower('Solution Category of Interest'),
        lower('Solution/Vendor Category You Offer')
      )
  LOOP
    FOR v_label IN SELECT jsonb_array_elements_text(v_answer.answer_json)
    LOOP
      v_label := trim(v_label);
      IF v_label = '' OR lower(v_label) = 'n/a' THEN CONTINUE; END IF;

      SELECT id INTO v_cat_id
      FROM public.event_solution_categories
      WHERE event_id = v_sub.event_id
        AND audience = v_audience
        AND lower(trim(category_name)) = lower(v_label)
      LIMIT 1;

      IF v_cat_id IS NULL THEN
        INSERT INTO public.event_solution_categories (event_id, category_name, display_order, audience)
        VALUES (
          v_sub.event_id,
          v_label,
          COALESCE(
            (SELECT MAX(display_order) + 1
             FROM public.event_solution_categories
             WHERE event_id = v_sub.event_id AND audience = v_audience),
            0
          ),
          v_audience
        )
        ON CONFLICT (event_id, audience, category_name) DO UPDATE SET updated_at = now()
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
      AND event_id = p_event_id
  ),
  candidates AS (
    SELECT s.id
    FROM public.event_registration_submissions s
    CROSS JOIN source src
    WHERE s.event_id = p_event_id
      AND s.id <> p_submission_id
      AND s.attendee_type = CASE
        WHEN src.attendee_type = 'vendor' THEN 'attendee'
        ELSE 'vendor'
      END
      AND s.status = 'submitted'
      AND s.registration_status = 'approved'
      AND s.profile_complete = true
      AND s.matching_opt_in = true
      AND s.rejected_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_meeting_interest_requests r
        WHERE r.event_id = p_event_id
          AND r.response_status = 'declined'
          AND (
            (r.submission_id = p_submission_id AND r.target_submission_id = s.id)
            OR (r.submission_id = s.id AND r.target_submission_id = p_submission_id)
          )
      )
  )
  SELECT
    c.id AS candidate_id,
    public.compute_match_score(p_event_id, p_submission_id, c.id) AS score,
    public.solution_category_overlap_count(p_submission_id, c.id) AS category_overlap
  FROM candidates c
  WHERE public.is_event_admin(p_event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
  ORDER BY score DESC, category_overlap DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.rank_submission_matches(UUID, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_submission_matches(UUID, UUID, INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rank_my_portal_match_suggestions(
  p_event_id UUID,
  p_submission_id UUID,
  p_limit INT DEFAULT 8
)
RETURNS TABLE (
  candidate_id UUID,
  score INT,
  category_overlap INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.id = p_submission_id
      AND s.event_id = p_event_id
      AND (
        s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
        OR public.is_event_admin(s.event_id)
        OR public.is_platform_admin(auth.uid())
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  SELECT COALESCE(ms.portal_match_suggestions_enabled, false)
  INTO v_enabled
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = p_event_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH source AS (
    SELECT attendee_type
    FROM public.event_registration_submissions
    WHERE id = p_submission_id
      AND event_id = p_event_id
  ),
  candidates AS (
    SELECT s.id
    FROM public.event_registration_submissions s
    CROSS JOIN source src
    WHERE s.event_id = p_event_id
      AND s.id <> p_submission_id
      AND s.attendee_type = CASE
        WHEN src.attendee_type = 'vendor' THEN 'attendee'
        ELSE 'vendor'
      END
      AND s.status = 'submitted'
      AND s.registration_status = 'approved'
      AND s.profile_complete = true
      AND s.matching_opt_in = true
      AND s.rejected_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_meeting_interest_requests r
        WHERE r.event_id = p_event_id
          AND r.response_status = 'declined'
          AND (
            (r.submission_id = p_submission_id AND r.target_submission_id = s.id)
            OR (r.submission_id = s.id AND r.target_submission_id = p_submission_id)
          )
      )
  )
  SELECT
    c.id AS candidate_id,
    public.compute_match_score(p_event_id, p_submission_id, c.id) AS score,
    public.solution_category_overlap_count(p_submission_id, c.id) AS category_overlap
  FROM candidates c
  ORDER BY score DESC, category_overlap DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.rank_my_portal_match_suggestions(UUID, UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_my_portal_match_suggestions(UUID, UUID, INT) TO authenticated, service_role;

-- Patch compute_match_score to compare category names across delegate/vendor lists.
DO $patch$
DECLARE
  v_def TEXT;
  v_old TEXT := $old$
  SELECT COUNT(*)::INT INTO v_cat_overlap
  FROM public.event_registration_solution_categories a
  JOIN public.event_registration_solution_categories b ON b.category_id = a.category_id
  WHERE a.submission_id = p_from_submission_id
    AND b.submission_id = p_to_submission_id;$old$;
  v_new TEXT := $new$
  v_cat_overlap := public.solution_category_overlap_count(p_from_submission_id, p_to_submission_id);$new$;
BEGIN
  SELECT pg_get_functiondef('public.compute_match_score(uuid,uuid,uuid)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'compute_match_score not found';
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'compute_match_score category overlap block not found';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;
