-- =============================================================================
-- B2B admin-only permissions + B2B meeting feedback + nudge table
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- Requires: meeting_bookings, meeting_slots, vendor_booths, event_members,
--           is_event_admin(), is_platform_admin() (from earlier migrations).
-- =============================================================================

-- ---------- 1) B2B: Only admins can create, edit, cancel ----------
DROP POLICY IF EXISTS "Users can book" ON public.meeting_bookings;
DROP POLICY IF EXISTS "Users can cancel own bookings" ON public.meeting_bookings;
DROP POLICY IF EXISTS "Vendors and admins can update event booth bookings" ON public.meeting_bookings;

CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );

-- ---------- 2) B2B meeting feedback table + RLS ----------
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

DROP POLICY IF EXISTS "Users can view own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Users can view own B2B feedback" ON public.b2b_meeting_feedback
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Event admins can view all B2B feedback in event" ON public.b2b_meeting_feedback;
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

DROP POLICY IF EXISTS "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meeting_bookings mb
      WHERE mb.id = b2b_meeting_feedback.booking_id AND mb.attendee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------- 3) Nudge-sent tracking table + RLS ----------
CREATE TABLE IF NOT EXISTS public.b2b_meeting_feedback_nudge_sent (
  booking_id UUID PRIMARY KEY REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.b2b_meeting_feedback_nudge_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event admins can view B2B nudge sent" ON public.b2b_meeting_feedback_nudge_sent;
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

-- ---------- 4) RPC: vendor performance for admins ----------
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

COMMENT ON TABLE public.b2b_meeting_feedback IS 'Attendee ratings for B2B vendor meetings.';
COMMENT ON TABLE public.b2b_meeting_feedback_nudge_sent IS 'One row per booking when we sent the rate-this-meeting nudge.';
