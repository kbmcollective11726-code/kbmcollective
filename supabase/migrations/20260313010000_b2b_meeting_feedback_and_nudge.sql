-- B2B meeting feedback: attendees rate their vendor meeting (1-5, comment, meet again, recommend, work-with likelihood).
-- Only attendee can submit; admins can view all for their event. One feedback per booking per user.

CREATE TABLE IF NOT EXISTS public.b2b_meeting_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  meet_again BOOLEAN NOT NULL,
  recommend_vendor BOOLEAN NOT NULL,
  work_with_likelihood SMALLINT NOT NULL CHECK (work_with_likelihood >= 1 AND work_with_likelihood <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(booking_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_meeting_feedback_booking ON public.b2b_meeting_feedback(booking_id);
CREATE INDEX IF NOT EXISTS idx_b2b_meeting_feedback_user ON public.b2b_meeting_feedback(user_id);

ALTER TABLE public.b2b_meeting_feedback ENABLE ROW LEVEL SECURITY;

-- Submitter sees own row
CREATE POLICY "Users can view own B2B feedback" ON public.b2b_meeting_feedback
  FOR SELECT USING (user_id = auth.uid());

-- Event admins see all feedback for bookings in their event
CREATE POLICY "Event admins can view all B2B feedback in event" ON public.b2b_meeting_feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meeting_bookings mb
      JOIN public.meeting_slots ms ON ms.id = mb.slot_id
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE mb.id = b2b_meeting_feedback.booking_id
        AND (public.is_event_admin(vb.event_id) OR public.is_platform_admin(auth.uid()))
    )
  );

-- Only the attendee for this booking can insert/update their feedback
CREATE POLICY "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meeting_bookings mb
      WHERE mb.id = b2b_meeting_feedback.booking_id AND mb.attendee_id = auth.uid()
    )
  );

CREATE POLICY "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Nudge sent: one row per booking so we only send one "rate this meeting" reminder
CREATE TABLE IF NOT EXISTS public.b2b_meeting_feedback_nudge_sent (
  booking_id UUID PRIMARY KEY REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only service role / Edge Function will insert; no RLS for app users needed (or allow admins to see for debugging)
ALTER TABLE public.b2b_meeting_feedback_nudge_sent ENABLE ROW LEVEL SECURITY;

-- Admins can view nudge_sent for their event's bookings (for debugging/dashboards)
CREATE POLICY "Event admins can view B2B nudge sent" ON public.b2b_meeting_feedback_nudge_sent
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meeting_bookings mb
      JOIN public.meeting_slots ms ON ms.id = mb.slot_id
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE mb.id = b2b_meeting_feedback_nudge_sent.booking_id
        AND (public.is_event_admin(vb.event_id) OR public.is_platform_admin(auth.uid()))
    )
  );

-- RPC: vendor performance for admins (event or single booth). Returns per-booth aggregates.
CREATE OR REPLACE FUNCTION public.get_b2b_vendor_performance(p_event_id UUID, p_booth_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_can_see BOOLEAN := false;
BEGIN
  v_can_see := public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid());
  IF NOT v_can_see THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(
      (SELECT jsonb_agg(booth_row ORDER BY booth_row->>'vendor_name')
       FROM (
         SELECT jsonb_build_object(
           'booth_id', vb.id,
           'vendor_name', vb.vendor_name,
           'feedback_count', COUNT(f.id)::int,
           'avg_rating', ROUND(AVG(f.rating)::numeric, 2),
           'pct_meet_again', ROUND(100.0 * COUNT(*) FILTER (WHERE f.meet_again) / NULLIF(COUNT(f.id), 0), 1),
           'pct_recommend', ROUND(100.0 * COUNT(*) FILTER (WHERE f.recommend_vendor) / NULLIF(COUNT(f.id), 0), 1),
           'avg_work_with_likelihood', ROUND(AVG(f.work_with_likelihood)::numeric, 2)
         ) AS booth_row
         FROM public.vendor_booths vb
         LEFT JOIN public.meeting_slots ms ON ms.booth_id = vb.id
         LEFT JOIN public.meeting_bookings mb ON mb.slot_id = ms.id
         LEFT JOIN public.b2b_meeting_feedback f ON f.booking_id = mb.id
         WHERE vb.event_id = p_event_id
           AND vb.is_active = true
           AND (p_booth_id IS NULL OR vb.id = p_booth_id)
         GROUP BY vb.id, vb.vendor_name
       ) sub),
      '[]'::jsonb
    )
  );
END;
$$;

COMMENT ON TABLE public.b2b_meeting_feedback IS 'Attendee ratings for B2B vendor meetings: 1-5 rating, comment, meet again, recommend, work-with likelihood.';
COMMENT ON TABLE public.b2b_meeting_feedback_nudge_sent IS 'Tracks that we sent a "rate this meeting" nudge for this booking (one per booking).';
