-- A declined participant request must not be suggested or regenerated as a match.

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
    (
      SELECT count(*)::INT
      FROM public.event_registration_solution_categories a
      JOIN public.event_registration_solution_categories b
        ON b.category_id = a.category_id
      WHERE a.submission_id = p_submission_id
        AND b.submission_id = c.id
    ) AS category_overlap
  FROM candidates c
  WHERE public.is_event_admin(p_event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
  ORDER BY score DESC, category_overlap DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.rank_submission_matches(UUID, UUID, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_submission_matches(UUID, UUID, INT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_event_match_suggestions(
  p_event_id UUID,
  p_limit INT DEFAULT 200
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delegate RECORD;
  v_vendor RECORD;
  v_score INT;
  v_inserted INT := 0;
BEGIN
  IF NOT (
    public.is_event_admin(p_event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR v_delegate IN
    SELECT id
    FROM public.event_registration_submissions
    WHERE event_id = p_event_id
      AND attendee_type = 'attendee'
      AND status = 'submitted'
      AND registration_status = 'approved'
      AND profile_complete = true
      AND matching_opt_in = true
      AND rejected_at IS NULL
  LOOP
    FOR v_vendor IN
      SELECT id
      FROM public.event_registration_submissions
      WHERE event_id = p_event_id
        AND attendee_type = 'vendor'
        AND status = 'submitted'
        AND registration_status = 'approved'
        AND profile_complete = true
        AND matching_opt_in = true
        AND rejected_at IS NULL
    LOOP
      IF EXISTS (
        SELECT 1
        FROM public.event_meeting_interest_requests r
        WHERE r.event_id = p_event_id
          AND r.response_status = 'declined'
          AND (
            (r.submission_id = v_delegate.id AND r.target_submission_id = v_vendor.id)
            OR (r.submission_id = v_vendor.id AND r.target_submission_id = v_delegate.id)
          )
      ) THEN
        CONTINUE;
      END IF;

      v_score := public.compute_match_score(p_event_id, v_delegate.id, v_vendor.id);
      IF v_score <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.event_match_reviews (
        event_id,
        from_submission_id,
        to_submission_id,
        score,
        status
      )
      VALUES (
        p_event_id,
        v_delegate.id,
        v_vendor.id,
        v_score,
        'pending'
      )
      ON CONFLICT (event_id, from_submission_id, to_submission_id)
      DO UPDATE SET score = EXCLUDED.score, updated_at = now()
      WHERE event_match_reviews.status = 'pending';

      v_inserted := v_inserted + 1;
      EXIT WHEN v_inserted >= p_limit;
    END LOOP;
    EXIT WHEN v_inserted >= p_limit;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_event_match_suggestions(UUID, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_event_match_suggestions(UUID, INT)
  TO authenticated, service_role;

