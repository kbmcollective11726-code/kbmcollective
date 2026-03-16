-- Fix: infinite recursion when inserting into chat_group_members.
-- The "Admins can manage chat group members" policy on chat_group_members does
--   EXISTS (SELECT 1 FROM chat_groups cg WHERE ...). That SELECT on chat_groups
-- was only allowed by "Members can view chat groups they are in", which does
--   EXISTS (SELECT 1 FROM chat_group_members ...) → recursion.
-- Add a SELECT policy on chat_groups so event/platform admins can read groups
-- in their event without touching chat_group_members.

DROP POLICY IF EXISTS "Admins can view chat groups in their event" ON public.chat_groups;
CREATE POLICY "Admins can view chat groups in their event" ON public.chat_groups
  FOR SELECT USING (
    public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid())
  );
