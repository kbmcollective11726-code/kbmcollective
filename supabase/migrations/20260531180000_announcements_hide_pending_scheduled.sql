-- Do not expose scheduled announcements in the app until sent_at is set.
-- Event/platform admins (cadmin) can still preview pending rows.

DROP POLICY IF EXISTS "Announcements visible to targets" ON public.announcements;

CREATE POLICY "Announcements visible to targets" ON public.announcements
FOR SELECT
USING (
  public.user_can_view_announcement(
    event_id,
    target_type,
    target_audience,
    target_user_ids
  )
  AND (
    scheduled_at IS NULL
    OR sent_at IS NOT NULL
    OR public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
  )
);
