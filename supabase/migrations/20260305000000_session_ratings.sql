-- Session ratings: attendees rate sessions 1-5 (and optional comment).
-- One row per user per session; rating block shown in session detail modal.

CREATE TABLE IF NOT EXISTS public.session_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_ratings_session ON public.session_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_session_ratings_user ON public.session_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_session_ratings_event ON public.session_ratings(event_id);

ALTER TABLE public.session_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own session ratings" ON public.session_ratings;
CREATE POLICY "Users can view own session ratings" ON public.session_ratings
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Event admins can view all session ratings in event" ON public.session_ratings;
CREATE POLICY "Event admins can view all session ratings in event" ON public.session_ratings
  FOR SELECT USING (
    public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Event members can insert own session rating" ON public.session_ratings;
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = session_ratings.event_id AND em.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own session rating" ON public.session_ratings;
CREATE POLICY "Users can update own session rating" ON public.session_ratings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RPC: get aggregate stats for a session (for admins or any event member)
CREATE OR REPLACE FUNCTION public.get_session_rating_stats(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_event_id UUID;
  v_can_see BOOLEAN := false;
  v_avg NUMERIC;
  v_count BIGINT;
BEGIN
  SELECT event_id INTO v_event_id
  FROM public.schedule_sessions WHERE id = p_session_id LIMIT 1;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('avg_rating', null, 'count', 0);
  END IF;
  v_can_see := public.is_event_admin(v_event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = auth.uid());
  IF NOT v_can_see THEN
    RETURN jsonb_build_object('avg_rating', null, 'count', 0);
  END IF;
  SELECT AVG(rating)::NUMERIC(3,2), count(*) INTO v_avg, v_count
  FROM public.session_ratings WHERE session_id = p_session_id;
  RETURN jsonb_build_object('avg_rating', v_avg, 'count', COALESCE(v_count, 0)::int);
END;
$$;
