-- Allow members to read events they joined even when is_active = false.
-- This enables "Recent events" history and limited viewing after admin disables an event.
-- Platform admins keep full access; public still only sees active events.

DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;

CREATE POLICY "Events are viewable by everyone" ON public.events
  FOR SELECT
  USING (
    is_active = true
    OR is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = events.id
        AND em.user_id = auth.uid()
    )
  );
