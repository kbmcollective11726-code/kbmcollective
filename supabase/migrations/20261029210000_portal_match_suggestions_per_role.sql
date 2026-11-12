-- Suggested matches on Meeting Selections: separate switches for vendors and delegates.

ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS portal_match_suggestions_vendors_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_match_suggestions_delegates_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE public.event_matchmaking_settings
SET portal_match_suggestions_vendors_enabled = portal_match_suggestions_enabled,
    portal_match_suggestions_delegates_enabled = portal_match_suggestions_enabled
WHERE portal_match_suggestions_enabled = true;

COMMENT ON COLUMN public.event_matchmaking_settings.portal_match_suggestions_vendors_enabled IS
  'When true, vendors see suggested delegates + Best match on Meeting Selections. Off by default.';
COMMENT ON COLUMN public.event_matchmaking_settings.portal_match_suggestions_delegates_enabled IS
  'When true, delegates see suggested vendors + Best match on Meeting Selections. Off by default.';

CREATE OR REPLACE FUNCTION public.rank_my_portal_match_suggestions(
  p_event_id uuid,
  p_submission_id uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(candidate_id uuid, score integer, category_overlap integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_source_type TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT s.attendee_type INTO v_source_type
  FROM public.event_registration_submissions s
  WHERE s.id = p_submission_id
    AND s.event_id = p_event_id
    AND (
      s.user_id = auth.uid()
      OR public.registration_submission_owned_by_auth(s.id)
      OR public.is_event_admin(s.event_id)
      OR public.is_platform_admin(auth.uid())
    );
  IF v_source_type IS NULL THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  SELECT CASE
    WHEN v_source_type = 'vendor' THEN COALESCE(ms.portal_match_suggestions_vendors_enabled, false)
    ELSE COALESCE(ms.portal_match_suggestions_delegates_enabled, false)
  END
  INTO v_enabled
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = p_event_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT s.id
    FROM public.event_registration_submissions s
    WHERE s.event_id = p_event_id
      AND s.id <> p_submission_id
      AND s.attendee_type = CASE
        WHEN v_source_type = 'vendor' THEN 'attendee'
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

REVOKE ALL ON FUNCTION public.rank_my_portal_match_suggestions(uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_my_portal_match_suggestions(uuid, uuid, integer)
  TO authenticated, service_role;
