-- Scheduled sponsor logo creatives (time windows in event wall-clock, resolved client-side).
CREATE TABLE IF NOT EXISTS public.event_sponsor_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES public.event_sponsors(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  label TEXT,
  /** Wall-clock storage (UTC components = venue time); see events.reminder_timezone at display time. */
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_creatives_window_chk CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_event_sponsor_creatives_sponsor
  ON public.event_sponsor_creatives(sponsor_id, sort_order, starts_at);

CREATE INDEX IF NOT EXISTS idx_event_sponsor_creatives_event
  ON public.event_sponsor_creatives(event_id, starts_at, ends_at);

COMMENT ON TABLE public.event_sponsor_creatives IS
  'Optional scheduled logo variants per sponsor. Times stored as wall-clock UTC; clients interpret using events.reminder_timezone.';

ALTER TABLE public.event_sponsor_creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event members can view sponsor creatives" ON public.event_sponsor_creatives;
CREATE POLICY "Event members can view sponsor creatives"
  ON public.event_sponsor_creatives
  FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = event_sponsor_creatives.event_id
        AND em.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Public read live wall sponsor creatives" ON public.event_sponsor_creatives;
CREATE POLICY "Public read live wall sponsor creatives"
  ON public.event_sponsor_creatives
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_sponsors s
      JOIN public.events e ON e.id = s.event_id
      WHERE s.id = event_sponsor_creatives.sponsor_id
        AND s.event_id = event_sponsor_creatives.event_id
        AND s.is_active = true
        AND s.show_on_live_wall = true
        AND e.is_active = true
    )
  );

DROP POLICY IF EXISTS "Event admins manage sponsor creatives" ON public.event_sponsor_creatives;
CREATE POLICY "Event admins manage sponsor creatives"
  ON public.event_sponsor_creatives
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
