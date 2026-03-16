-- Allow event vendors and admins to view and update (confirm/decline) meeting bookings
-- for slots that belong to vendor booths in their event.

-- Vendors/admins can view meeting bookings for their event's booth slots
CREATE POLICY "Vendors and admins can view event booth bookings" ON public.meeting_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin', 'vendor')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );

-- Vendors/admins can update booking status (confirm/decline) for their event's booth slots
CREATE POLICY "Vendors and admins can update event booth bookings" ON public.meeting_bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin', 'vendor')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
