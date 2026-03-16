-- Allow event admins to INSERT meeting_bookings (assign meetings); attendees can still self-book via existing policy.
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
