-- Allow platform admins to manage point_rules (matches announcements / posts pattern).
-- Fixes "Failed to add rule" for org owners who are not in event_members as event admin.

DROP POLICY IF EXISTS "Admins can manage point rules" ON public.point_rules;

CREATE POLICY "Admins can manage point rules" ON public.point_rules
  FOR ALL
  USING (
    public.is_event_admin(event_id)
    OR public.is_platform_admin(auth.uid())
  );
