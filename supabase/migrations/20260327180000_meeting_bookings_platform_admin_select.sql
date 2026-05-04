-- Mobile Schedule: platform admins load all B2B bookings for overview without an event_members row.
DROP POLICY IF EXISTS "Platform admins can view meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Platform admins can view meeting bookings" ON public.meeting_bookings
  FOR SELECT USING (public.is_platform_admin(auth.uid()));
