-- Fix: "new row violates row-level security policy for table 'announcements'"
-- Run this in Supabase SQL Editor. Ensures event admins and platform admins can create/update/delete announcements.
-- Requires: is_event_admin() and is_platform_admin() already exist (from main schema).

DROP POLICY IF EXISTS "Admins can create announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;

CREATE POLICY "Admins can create announcements" ON public.announcements FOR INSERT WITH CHECK (
  public.is_event_admin(announcements.event_id) OR public.is_platform_admin(auth.uid())
);

CREATE POLICY "Admins can update announcements" ON public.announcements FOR UPDATE USING (
  public.is_event_admin(announcements.event_id) OR public.is_platform_admin(auth.uid())
);

CREATE POLICY "Admins can delete announcements" ON public.announcements FOR DELETE USING (
  public.is_event_admin(announcements.event_id) OR public.is_platform_admin(auth.uid())
);
