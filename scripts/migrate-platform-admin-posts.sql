-- ============================================
-- Super admin can manage (delete) any post
-- ============================================
-- Run in Supabase SQL Editor after full schema (or migrate-platform-admin.sql).
-- Lets platform admins soft-delete or moderate posts in any event.
-- ============================================

DROP POLICY IF EXISTS "Platform admins can manage all posts" ON public.posts;
CREATE POLICY "Platform admins can manage all posts" ON public.posts
  FOR ALL
  USING (public.is_platform_admin(auth.uid()));
