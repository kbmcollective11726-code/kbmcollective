-- ============================================
-- Fix: infinite recursion in event_members RLS
-- Run this ONCE in Supabase SQL Editor if you see
-- "infinite recursion detected in policy for relation event_members"
-- ============================================

-- 1. Helper that checks admin status without triggering RLS on event_members
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

-- 2. Replace the recursive policy with one that uses the helper
DROP POLICY IF EXISTS "Admins can manage members" ON public.event_members;
CREATE POLICY "Admins can manage members" ON public.event_members FOR ALL USING (public.is_event_admin(event_id));
