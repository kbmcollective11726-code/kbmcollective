-- Live wall: optional sponsor logos (public anon read when flagged).
ALTER TABLE public.event_sponsors
  ADD COLUMN IF NOT EXISTS show_on_live_wall boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_sponsors.show_on_live_wall IS 'When true, active sponsor row is readable by anon key for the public live wall.';

DROP POLICY IF EXISTS "Public read live wall sponsors" ON public.event_sponsors;
CREATE POLICY "Public read live wall sponsors" ON public.event_sponsors
  FOR SELECT
  USING (
    is_active = true
    AND show_on_live_wall = true
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sponsors.event_id AND e.is_active = true
    )
  );
