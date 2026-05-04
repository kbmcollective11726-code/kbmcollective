-- Fix anon/public registration inserts when event_matchmaking_settings
-- is protected by RLS in environments missing the public SELECT policy.
-- Use SECURITY DEFINER helper so policy checks do not depend on anon SELECT.

CREATE OR REPLACE FUNCTION public.is_event_registration_open(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_matchmaking_settings s
    WHERE s.event_id = p_event_id
      AND s.registration_open = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_event_registration_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_registration_open(UUID) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public insert submissions when registration open" ON public.event_registration_submissions;
CREATE POLICY "Public insert submissions when registration open" ON public.event_registration_submissions
  FOR INSERT
  WITH CHECK (
    user_id IS NULL
    AND public.is_event_registration_open(event_id)
  );

DROP POLICY IF EXISTS "Public insert answers for open registration submissions" ON public.event_registration_answers;
CREATE POLICY "Public insert answers for open registration submissions" ON public.event_registration_answers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions sub
      WHERE sub.id = event_registration_answers.submission_id
        AND sub.user_id IS NULL
        AND public.is_event_registration_open(sub.event_id)
    )
  );

DROP POLICY IF EXISTS "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions sub
      WHERE sub.id = event_meeting_interest_requests.submission_id
        AND sub.user_id IS NULL
        AND public.is_event_registration_open(sub.event_id)
    )
  );
