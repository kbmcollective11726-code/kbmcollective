-- Ensure helper functions and column exist for RLS (group chat, announcements, etc.).
-- Safe to run: uses CREATE OR REPLACE and ADD COLUMN IF NOT EXISTS.

-- Column required by is_platform_admin()
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Event admin check (used by chat_groups, chat_group_members, event_members, etc.)
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

-- Platform admin check (used by chat_groups, events, etc.)
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
