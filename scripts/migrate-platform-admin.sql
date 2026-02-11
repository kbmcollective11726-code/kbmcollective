-- ============================================
-- PLATFORM ADMIN (app owner) — see all events, disable/enable any event
-- ============================================
-- Run in Supabase SQL Editor. Then set your app-owner user to platform admin:
--   UPDATE public.users SET is_platform_admin = true WHERE id = 'your-auth-user-uuid';
-- ============================================

-- Add platform admin flag to users (app owner / you)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Helper: is current user a platform admin?
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

-- Events: platform admins can see ALL events (including inactive) and update/delete any
DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;
CREATE POLICY "Events are viewable by everyone" ON public.events FOR SELECT USING (
  is_active = true OR public.is_platform_admin(auth.uid())
);

DROP POLICY IF EXISTS "Admins can update events" ON public.events;
CREATE POLICY "Admins can update events" ON public.events FOR UPDATE USING (
  public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = events.id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  )
);

DROP POLICY IF EXISTS "Admins can delete events" ON public.events;
CREATE POLICY "Admins can delete events" ON public.events FOR DELETE USING (
  public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = events.id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  )
);
