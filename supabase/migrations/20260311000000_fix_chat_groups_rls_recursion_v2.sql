-- Fix: infinite recursion when inserting into chat_group_members (42P17).
-- Any SELECT policy on chat_groups that references chat_group_members causes
-- recursion when we insert into chat_group_members (RLS checks chat_groups,
-- which then checks chat_group_members again). Remove ALL chat_groups policies
-- that reference chat_group_members. Event members can still see groups via
-- event_members (no cgm ref).

DROP POLICY IF EXISTS "View chat groups: member or event admin or creator" ON public.chat_groups;
DROP POLICY IF EXISTS "Members can view chat groups they are in" ON public.chat_groups;

CREATE POLICY "Event members and creator can view chat groups in event" ON public.chat_groups
  FOR SELECT USING (
    (created_by = auth.uid())
    OR public.is_event_admin(event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = chat_groups.event_id AND em.user_id = auth.uid()
    )
  );
