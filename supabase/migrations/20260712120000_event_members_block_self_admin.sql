-- Block privilege escalation: authenticated users may self-join / self-update only as
-- attendee|speaker|vendor. Event/platform admins retain full insert/update (including admin roles).
-- Also constrain roles[] so admin cannot be smuggled via the multi-role array.

DROP POLICY IF EXISTS event_members_insert_perm ON public.event_members;
CREATE POLICY event_members_insert_perm ON public.event_members
  FOR INSERT
  WITH CHECK (
    is_event_admin(event_id)
    OR is_platform_admin((SELECT auth.uid()))
    OR (
      (SELECT auth.uid()) = user_id
      AND role = ANY (ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text])
      AND (
        roles IS NULL
        OR roles <@ ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text]
      )
    )
  );

DROP POLICY IF EXISTS event_members_update_perm ON public.event_members;
CREATE POLICY event_members_update_perm ON public.event_members
  FOR UPDATE
  USING (
    is_event_admin(event_id)
    OR is_platform_admin((SELECT auth.uid()))
    OR (SELECT auth.uid()) = user_id
  )
  WITH CHECK (
    is_event_admin(event_id)
    OR is_platform_admin((SELECT auth.uid()))
    OR (
      (SELECT auth.uid()) = user_id
      AND role = ANY (ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text])
      AND (
        roles IS NULL
        OR roles <@ ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text]
      )
    )
  );
