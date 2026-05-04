-- Event sponsors: tier label + logo placements (Info screen, hamburger) per event.
CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  /** Display label, e.g. "Presenting", "Gold", "Supporter" (packages map to this + placement flags). */
  tier_label TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  show_on_info_screen BOOLEAN NOT NULL DEFAULT true,
  show_in_hamburger BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_sponsors_event_sort ON public.event_sponsors(event_id, sort_order, id);

ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;

-- Members and platform admins can list sponsors for events they can access
DROP POLICY IF EXISTS "Event members can view event sponsors" ON public.event_sponsors;
CREATE POLICY "Event members can view event sponsors" ON public.event_sponsors
  FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = event_sponsors.event_id AND em.user_id = auth.uid()
    )
  );

-- Event admins + platform admins can manage rows
DROP POLICY IF EXISTS "Event admins manage event sponsors" ON public.event_sponsors;
CREATE POLICY "Event admins manage event sponsors" ON public.event_sponsors
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
