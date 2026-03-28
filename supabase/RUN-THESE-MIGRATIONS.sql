-- =============================================================================
-- Run this ENTIRE file in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- =============================================================================
-- Use this so that:
--   • Vendor booth Save works (creates/updates vendor_booths)
--   • Assign meeting works (admin can assign attendees to meetings)
--   • Session ratings and B2B banner_url are available
-- If you get "permission denied" or "row-level security" when saving a vendor
-- or assigning a meeting, run this file once in the SQL Editor.
-- =============================================================================

-- 0) B2B tables and base RLS (creates tables if missing so vendor save works)
-- -----------------------------------------------------------------------------
-- Requires: public.events, public.users, public.event_members exist (main app schema)
CREATE TABLE IF NOT EXISTS public.vendor_booths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  booth_location TEXT,
  contact_user_id UUID REFERENCES public.users(id),
  website TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.meeting_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id UUID NOT NULL REFERENCES public.vendor_booths(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.meeting_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.meeting_slots(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, attendee_id)
);

ALTER TABLE public.vendor_booths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_bookings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendor_booths ADD COLUMN IF NOT EXISTS banner_url TEXT;

DROP POLICY IF EXISTS "Vendor booths viewable" ON public.vendor_booths;
CREATE POLICY "Vendor booths viewable" ON public.vendor_booths FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage booths" ON public.vendor_booths;
CREATE POLICY "Admins manage booths" ON public.vendor_booths FOR ALL USING (
  EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = vendor_booths.event_id AND role IN ('admin', 'super_admin'))
);

DROP POLICY IF EXISTS "Slots viewable" ON public.meeting_slots;
CREATE POLICY "Slots viewable" ON public.meeting_slots FOR SELECT USING (true);
DROP POLICY IF EXISTS "Vendors manage slots" ON public.meeting_slots;
CREATE POLICY "Vendors manage slots" ON public.meeting_slots FOR ALL USING (
  EXISTS (SELECT 1 FROM public.vendor_booths vb JOIN public.event_members em ON em.event_id = vb.event_id WHERE vb.id = meeting_slots.booth_id AND em.user_id = auth.uid() AND em.role IN ('vendor', 'admin', 'super_admin'))
);

DROP POLICY IF EXISTS "Users see own bookings" ON public.meeting_bookings;
CREATE POLICY "Users see own bookings" ON public.meeting_bookings FOR SELECT USING (auth.uid() = attendee_id);
DROP POLICY IF EXISTS "Users can book" ON public.meeting_bookings;
CREATE POLICY "Users can book" ON public.meeting_bookings FOR INSERT WITH CHECK (auth.uid() = attendee_id);
DROP POLICY IF EXISTS "Users can cancel own bookings" ON public.meeting_bookings;
CREATE POLICY "Users can cancel own bookings" ON public.meeting_bookings FOR UPDATE USING (auth.uid() = attendee_id);

-- 1) Session ratings (Agenda: rate sessions 1–5 in modal)
-- -----------------------------------------------------------------------------
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

CREATE POLICY "Users can view own session ratings" ON public.session_ratings
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Event admins can view all session ratings in event" ON public.session_ratings
  FOR SELECT USING (
    public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = session_ratings.event_id AND em.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own session rating" ON public.session_ratings
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_session_rating_stats(p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_event_id UUID; v_can_see BOOLEAN := false; v_avg NUMERIC; v_count BIGINT;
BEGIN
  SELECT event_id INTO v_event_id FROM public.schedule_sessions WHERE id = p_session_id LIMIT 1;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('avg_rating', null, 'count', 0); END IF;
  v_can_see := public.is_event_admin(v_event_id) OR public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = auth.uid());
  IF NOT v_can_see THEN RETURN jsonb_build_object('avg_rating', null, 'count', 0); END IF;
  SELECT AVG(rating)::NUMERIC(3,2), count(*) INTO v_avg, v_count FROM public.session_ratings WHERE session_id = p_session_id;
  RETURN jsonb_build_object('avg_rating', v_avg, 'count', COALESCE(v_count, 0)::int);
END; $$;

-- 2) B2B: vendors/admins can view and update meeting bookings; admins can assign (INSERT)
-- -----------------------------------------------------------------------------
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings
  FOR INSERT WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
CREATE POLICY "Vendors and admins can view event booth bookings" ON public.meeting_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin', 'vendor')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
CREATE POLICY "Vendors and admins can update event booth bookings" ON public.meeting_bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin', 'vendor')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );

-- 3) Vendor booth banner image URL
-- -----------------------------------------------------------------------------
ALTER TABLE public.vendor_booths ADD COLUMN IF NOT EXISTS banner_url TEXT;
