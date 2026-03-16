-- ============================================================
-- FIX: Groups not showing + "not a member" + recursion errors
-- ------------------------------------------------------------
-- 1. Open Supabase Dashboard → your project
-- 2. Go to SQL Editor → New query
-- 3. Paste this ENTIRE file and click Run
-- 4. Reload the app and open Profile → Groups (same event you used to create the group)
-- ------------------------------------------------------------
-- This script: lets creators see their groups, fixes recursion, adds all chat_groups policies.
-- ============================================================

-- 1) Ensure users column for platform admin
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- 2) Helper table: group_id -> event_id (no RLS, so no recursion when function reads it)
CREATE TABLE IF NOT EXISTS public.chat_group_event (
  group_id UUID PRIMARY KEY REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE
);
ALTER TABLE public.chat_group_event DISABLE ROW LEVEL SECURITY;
-- Keep it in sync with chat_groups (backfill existing, then trigger for new)
INSERT INTO public.chat_group_event (group_id, event_id)
  SELECT id, event_id FROM public.chat_groups
  ON CONFLICT (group_id) DO UPDATE SET event_id = EXCLUDED.event_id;

CREATE OR REPLACE FUNCTION public.sync_chat_group_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.chat_group_event (group_id, event_id) VALUES (NEW.id, NEW.event_id)
  ON CONFLICT (group_id) DO UPDATE SET event_id = EXCLUDED.event_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_chat_group_event_trigger ON public.chat_groups;
CREATE TRIGGER sync_chat_group_event_trigger
  AFTER INSERT OR UPDATE OF event_id ON public.chat_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_chat_group_event();

-- 3) Helper: is current user event admin?
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  );
$$;

-- 4) Helper: is current user platform admin?
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(
    (SELECT u.is_platform_admin FROM public.users u WHERE u.id = p_user_id),
    false
  );
$$;

-- 5) Can current user manage this group's members? Reads ONLY chat_group_event (no RLS) + event_members/users = no recursion
CREATE OR REPLACE FUNCTION public.can_manage_chat_group_members(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT (public.is_event_admin(cge.event_id) OR public.is_platform_admin(auth.uid()))
  FROM public.chat_group_event cge
  WHERE cge.group_id = p_group_id
  LIMIT 1;
$$;

-- 5b) Is user in this group? (SECURITY DEFINER = no RLS recursion when used in SELECT policy)
CREATE OR REPLACE FUNCTION public.is_member_of_chat_group(p_group_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = p_group_id AND user_id = p_user_id);
$$;

-- 5c) Return actual member count for a group (only if caller can see the group)
CREATE OR REPLACE FUNCTION public.get_chat_group_member_count(p_group_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_event_id UUID;
  v_created_by UUID;
  v_can_see BOOLEAN := false;
BEGIN
  SELECT cg.event_id, cg.created_by INTO v_event_id, v_created_by
  FROM public.chat_groups cg WHERE cg.id = p_group_id LIMIT 1;
  IF v_event_id IS NULL THEN
    RETURN 0;
  END IF;
  v_can_see := (v_created_by = auth.uid())
    OR public.is_event_admin(v_event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = auth.uid())
    OR public.is_member_of_chat_group(p_group_id, auth.uid());
  IF NOT v_can_see THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(*)::INTEGER FROM public.chat_group_members WHERE group_id = p_group_id);
END;
$$;

-- 6) chat_groups: DROP ALL SELECT policies then one SELECT (creators + event members + admins see groups)
DROP POLICY IF EXISTS "Members can view chat groups they are in" ON public.chat_groups;
DROP POLICY IF EXISTS "Admins can view chat groups in their event" ON public.chat_groups;
DROP POLICY IF EXISTS "View chat groups: member or event admin" ON public.chat_groups;
DROP POLICY IF EXISTS "View chat groups: member or event admin or creator" ON public.chat_groups;
DROP POLICY IF EXISTS "View chat groups in event" ON public.chat_groups;
CREATE POLICY "View chat groups: member or event admin or creator" ON public.chat_groups
  FOR SELECT USING (
    created_by = auth.uid()
    OR public.is_event_admin(event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = chat_groups.event_id AND em.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_group_members cgm
      WHERE cgm.group_id = chat_groups.id AND cgm.user_id = auth.uid()
    )
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

-- 7) chat_group_members: DROP ALL POLICIES then create the policies below (removes any leftover that causes recursion)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_group_members')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chat_group_members', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members
  FOR ALL
  USING (public.can_manage_chat_group_members(group_id))
  WITH CHECK (public.can_manage_chat_group_members(group_id));

CREATE POLICY "Members can view chat group members" ON public.chat_group_members
  FOR SELECT USING (
    public.can_manage_chat_group_members(group_id) OR public.is_member_of_chat_group(group_id, auth.uid())
  );

-- Creators can add themselves to their own group (so backfill works and they count as member)
CREATE POLICY "Creators can add themselves to chat group members" ON public.chat_group_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_groups g
      WHERE g.id = group_id AND g.created_by = auth.uid()
    )
  );

-- Done. Try creating a group again in the app.
