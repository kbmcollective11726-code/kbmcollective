-- Allow event admins to update public.users rows for people who are members of an event they administer
-- (Members page "Edit profile"). UI should only send directory fields, not is_platform_admin.

DROP POLICY IF EXISTS "Event admins can update event member profiles" ON public.users;

CREATE POLICY "Event admins can update event member profiles"
ON public.users
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.user_id = users.id
      AND public.is_event_admin(em.event_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.user_id = users.id
      AND public.is_event_admin(em.event_id)
  )
);
