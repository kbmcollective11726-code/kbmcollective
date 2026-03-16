-- ============================================================
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query.
-- Fixes: admin helpers for RLS + group creation recursion.
-- ============================================================

-- 1) Ensure helper functions and column exist
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT u.is_platform_admin FROM public.users u WHERE u.id = p_user_id),
    false
  );
$$;

-- 2) Function so chat_group_members policy can check "admin for this group" without triggering RLS on chat_groups (avoids recursion)
CREATE OR REPLACE FUNCTION public.can_manage_chat_group_members(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT (public.is_event_admin(cg.event_id) OR public.is_platform_admin(auth.uid()))
  FROM public.chat_groups cg
  WHERE cg.id = p_group_id
  LIMIT 1;
$$;
COMMENT ON FUNCTION public.can_manage_chat_group_members(UUID) IS 'Used by RLS on chat_group_members; definer reads chat_groups without triggering RLS.';

-- 3) Fix chat_groups SELECT: CASE WHEN so admins never trigger a read on chat_group_members
--    (A OR B can still evaluate B; CASE WHEN admin THEN true ELSE member_check END avoids that.)
DROP POLICY IF EXISTS "Members can view chat groups they are in" ON public.chat_groups;
DROP POLICY IF EXISTS "Admins can view chat groups in their event" ON public.chat_groups;
DROP POLICY IF EXISTS "View chat groups: member or event admin" ON public.chat_groups;
CREATE POLICY "View chat groups: member or event admin" ON public.chat_groups
  FOR SELECT USING (
    CASE
      WHEN public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()) THEN true
      ELSE EXISTS (
        SELECT 1 FROM public.chat_group_members cgm
        WHERE cgm.group_id = chat_groups.id AND cgm.user_id = auth.uid()
      )
    END
  );

DROP POLICY IF EXISTS "Admins can create chat groups" ON public.chat_groups;
CREATE POLICY "Admins can create chat groups" ON public.chat_groups
  FOR INSERT WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update chat groups" ON public.chat_groups;
CREATE POLICY "Admins can update chat groups" ON public.chat_groups
  FOR UPDATE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete chat groups" ON public.chat_groups;
CREATE POLICY "Admins can delete chat groups" ON public.chat_groups
  FOR DELETE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

-- 4) Fix chat_group_members: use function instead of inline SELECT from chat_groups (stops recursion)
DROP POLICY IF EXISTS "Admins can manage chat group members" ON public.chat_group_members;
CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members
  FOR ALL
  USING (public.can_manage_chat_group_members(group_id))
  WITH CHECK (public.can_manage_chat_group_members(group_id));
