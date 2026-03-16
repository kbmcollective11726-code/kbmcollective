-- Fix: infinite recursion when inserting into group_messages (42P17).
-- The policy "Members can view chat group members" used inline EXISTS (SELECT from
-- chat_group_members), causing recursion when group_messages INSERT checks membership.
-- Use SECURITY DEFINER helpers so RLS is not re-entered: can_manage_chat_group_members
-- (reads chat_group_event only) and is_member_of_chat_group (definer reads chat_group_members).

-- Ensure helpers exist (from FIX-GROUP-RECURSION.sql or similar)
-- can_manage_chat_group_members(p_group_id) - reads chat_group_event
-- is_member_of_chat_group(p_group_id, p_user_id) - SECURITY DEFINER, reads chat_group_members

DROP POLICY IF EXISTS "Members can view chat group members" ON public.chat_group_members;

CREATE POLICY "Members can view chat group members" ON public.chat_group_members
  FOR SELECT USING (
    public.can_manage_chat_group_members(group_id)
    OR public.is_member_of_chat_group(group_id, auth.uid())
  );
