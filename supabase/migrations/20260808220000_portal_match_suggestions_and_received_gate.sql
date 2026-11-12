-- Portal match suggestions + received-request visibility (both off by default).
-- Event admins opt in; registrants never see "who requested me" or suggested matches unless enabled.

ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS portal_match_suggestions_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_received_requests_visible BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_matchmaking_settings.portal_match_suggestions_enabled IS
  'When true, registrants see suggested counterparts + form-fit why on Meeting Selections. Off by default.';
COMMENT ON COLUMN public.event_matchmaking_settings.portal_received_requests_visible IS
  'When true, registrants can see who requested them (Received). Off by default.';

-- Rank suggestions for the viewer's own submission when the event toggle is on.
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
    (
      SELECT count(*)::INT
      FROM public.event_registration_solution_categories a
      JOIN public.event_registration_solution_categories b
        ON b.category_id = a.category_id
      WHERE a.submission_id = p_submission_id
        AND b.submission_id = c.id
    ) AS category_overlap
  FROM candidates c
  ORDER BY score DESC, category_overlap DESC
  LIMIT GREATEST(COALESCE(p_limit, 8), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.rank_my_portal_match_suggestions(UUID, UUID, INT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_my_portal_match_suggestions(UUID, UUID, INT)
  TO authenticated, service_role;

-- Hide received-request sender identity unless the event admin enables it.
CREATE OR REPLACE FUNCTION public.list_my_received_meeting_requests(
  p_event_id UUID,
  p_submission_id UUID
)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  submission_id UUID,
  target_submission_id UUID,
  sender_first_name TEXT,
  sender_last_name TEXT,
  sender_company_name TEXT,
  sender_job_title TEXT,
  reason TEXT,
  interest_level TEXT,
  response_status TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visible BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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

  v_is_admin := public.is_event_admin(p_event_id)
    OR public.is_platform_admin(auth.uid());

  SELECT COALESCE(ms.portal_received_requests_visible, false)
  INTO v_visible
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = p_event_id;

  -- Registrants only see senders when the event toggle is on.
  -- Event/platform admins keep access for support.
  IF NOT COALESCE(v_visible, false) AND NOT v_is_admin THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.event_id, r.submission_id, r.target_submission_id,
    s.first_name, s.last_name, s.company_name, s.job_title,
    r.reason, r.interest_level, r.response_status, r.responded_at, r.created_at
  FROM public.event_meeting_interest_requests r
  JOIN public.event_registration_submissions s ON s.id = r.submission_id
  WHERE r.event_id = p_event_id
    AND r.target_submission_id = p_submission_id
  ORDER BY
    CASE r.response_status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
    r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_received_meeting_requests(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_received_meeting_requests(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.respond_to_meeting_request(
  p_request_id UUID,
  p_response_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.event_meeting_interest_requests%ROWTYPE;
  v_visible BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_response_status NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Response must be accepted or declined';
  END IF;

  SELECT * INTO v_request
  FROM public.event_meeting_interest_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Meeting request not found'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.id = v_request.target_submission_id
      AND (
        s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
  ) THEN
    RAISE EXCEPTION 'Only the request recipient can respond';
  END IF;
  IF NOT public.is_event_meeting_requests_open(v_request.event_id) THEN
    RAISE EXCEPTION 'Meeting requests are closed';
  END IF;

  SELECT COALESCE(ms.portal_received_requests_visible, false)
  INTO v_visible
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = v_request.event_id;

  IF NOT COALESCE(v_visible, false) THEN
    RAISE EXCEPTION 'Received requests are not enabled for this event';
  END IF;

  UPDATE public.event_meeting_interest_requests
  SET response_status = p_response_status
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_meeting_request(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_meeting_request(UUID, TEXT)
  TO authenticated, service_role;
