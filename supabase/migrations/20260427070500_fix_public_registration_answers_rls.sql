-- Fix anon/public inserts into event_registration_answers and
-- event_meeting_interest_requests when the policy references
-- event_registration_submissions under RLS.

CREATE OR REPLACE FUNCTION public.is_public_registration_submission(p_submission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions sub
    WHERE sub.id = p_submission_id
      AND sub.user_id IS NULL
      AND public.is_event_registration_open(sub.event_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_registration_submission(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_registration_submission(UUID) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public insert answers for open registration submissions" ON public.event_registration_answers;
CREATE POLICY "Public insert answers for open registration submissions" ON public.event_registration_answers
  FOR INSERT
  WITH CHECK (public.is_public_registration_submission(submission_id));

DROP POLICY IF EXISTS "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests
  FOR INSERT
  WITH CHECK (public.is_public_registration_submission(submission_id));
