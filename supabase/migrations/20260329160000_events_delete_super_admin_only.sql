-- Only platform admins or event super_admins may DELETE an event (not regular event admins).
-- Aligns with web admin "Delete event" shown only to those users.

DROP POLICY IF EXISTS "Admins can delete events" ON public.events;

CREATE POLICY "Super admins can delete events" ON public.events
  FOR DELETE
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = events.id
        AND em.user_id = auth.uid()
        AND (
          em.role = 'super_admin'
          OR 'super_admin' = ANY (COALESCE(em.roles, ARRAY[]::text[]))
        )
    )
  );

COMMENT ON POLICY "Super admins can delete events" ON public.events IS
  'DELETE allowed for platform admins or members with super_admin (role column or roles[]).';
