-- Per-session control: when false, mobile/web hide star rating UI; session_ratings cannot be inserted or updated.
ALTER TABLE public.schedule_sessions
  ADD COLUMN IF NOT EXISTS ratings_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.schedule_sessions.ratings_enabled IS 'When false, app hides session rating UI; RLS blocks new/updated session_ratings.';

-- Require ratings_enabled on the session for new ratings
DROP POLICY IF EXISTS "Event members can insert own session rating" ON public.session_ratings;
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = session_ratings.event_id AND em.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.schedule_sessions s
      WHERE s.id = session_ratings.session_id AND s.ratings_enabled = true
    )
  );

-- Block edits to ratings when the session has feedback turned off
DROP POLICY IF EXISTS "Users can update own session rating" ON public.session_ratings;
CREATE POLICY "Users can update own session rating" ON public.session_ratings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.schedule_sessions s
      WHERE s.id = session_ratings.session_id AND s.ratings_enabled = true
    )
  );
