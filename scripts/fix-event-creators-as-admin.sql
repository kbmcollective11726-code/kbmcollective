-- ============================================
-- Fix: Event creators should be event admins
-- Run in Supabase SQL Editor once.
-- ============================================
-- 1. Ensure the trigger exists so NEW event creators become admin
--    (If you already ran migrate-admin-create-events.sql, this is redundant.)
-- 2. Fix EXISTING events: set role = 'admin' for any member who created that event
--    but is currently not admin (e.g. they show as attendee).

-- Step 1: Trigger so future event inserts add creator as admin
CREATE OR REPLACE FUNCTION public.add_creator_as_event_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.event_members (event_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'admin')
    ON CONFLICT (event_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS add_creator_as_admin_after_insert ON public.events;
CREATE TRIGGER add_creator_as_admin_after_insert
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.add_creator_as_event_admin();

-- Step 2: Fix existing data – anyone who created an event is set to admin for that event
UPDATE public.event_members em
SET role = 'admin'
FROM public.events e
WHERE e.id = em.event_id
  AND e.created_by = em.user_id
  AND em.role NOT IN ('admin', 'super_admin');
