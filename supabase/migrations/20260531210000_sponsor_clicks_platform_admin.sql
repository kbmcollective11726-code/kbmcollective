-- Allow platform admins to log sponsor clicks even without an event_members row (testing + super-admin app use).

DROP POLICY IF EXISTS "Event members log sponsor clicks" ON public.event_sponsor_clicks;
CREATE POLICY "Event members log sponsor clicks"
  ON public.event_sponsor_clicks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.event_members em
        WHERE em.event_id = event_sponsor_clicks.event_id
          AND em.user_id = auth.uid()
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.event_sponsors s
      WHERE s.id = event_sponsor_clicks.sponsor_id
        AND s.event_id = event_sponsor_clicks.event_id
        AND s.is_active = true
    )
  );
