-- Admin review queue + scheduling board persistence for matchmaking.

CREATE TABLE IF NOT EXISTS public.event_match_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  from_submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  to_submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_match_reviews_pair_unique UNIQUE (event_id, from_submission_id, to_submission_id)
);

CREATE INDEX IF NOT EXISTS idx_event_match_reviews_event_status
  ON public.event_match_reviews(event_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.event_match_scheduled_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  review_id UUID REFERENCES public.event_match_reviews(id) ON DELETE SET NULL,
  submission_a_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  submission_b_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_match_scheduled_meetings_event_start
  ON public.event_match_scheduled_meetings(event_id, start_time);

ALTER TABLE public.event_match_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_match_scheduled_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event admins manage match reviews" ON public.event_match_reviews;
CREATE POLICY "Event admins manage match reviews" ON public.event_match_reviews
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Event admins manage scheduled matches" ON public.event_match_scheduled_meetings;
CREATE POLICY "Event admins manage scheduled matches" ON public.event_match_scheduled_meetings
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
