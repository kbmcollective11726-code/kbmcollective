-- ============================================
-- Super admin can assign event admins
-- ============================================
-- Run in Supabase SQL Editor after migrate-platform-admin.sql (or full schema).
-- Lets platform admins (is_platform_admin = true) manage event_members for any event,
-- so they can add members and set role to admin/super_admin when not in that event.
-- ============================================

DROP POLICY IF EXISTS "Platform admins can manage event members" ON public.event_members;
CREATE POLICY "Platform admins can manage event members" ON public.event_members
  FOR ALL
  USING (public.is_platform_admin(auth.uid()));
