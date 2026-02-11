-- Run this in Supabase SQL Editor if you have the OLD events RLS
-- (one policy "Admins can manage events" FOR ALL).
-- This allows any authenticated user to create events and makes the creator an admin.

-- Drop old policy (if it exists)
DROP POLICY IF EXISTS "Admins can manage events" ON public.events;

-- Any authenticated user can create an event
CREATE POLICY "Authenticated users can create events" ON public.events
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Only admins can update/delete events
CREATE POLICY "Admins can update events" ON public.events FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin'))
);
CREATE POLICY "Admins can delete events" ON public.events FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin'))
);

-- After creating an event, add the creator as admin
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
