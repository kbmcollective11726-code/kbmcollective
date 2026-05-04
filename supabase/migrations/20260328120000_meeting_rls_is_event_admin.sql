-- Meeting bookings & slots: use is_event_admin(event_id) so admins in event_members.roles[] work,
-- matching vendor_booths RLS. Platform admin policies stay separate (OR semantics).

DROP POLICY IF EXISTS "Vendors and admins can view event booth bookings" ON public.meeting_bookings;
CREATE POLICY "Vendors and admins can view event booth bookings" ON public.meeting_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE ms.id = meeting_bookings.slot_id
        AND (
          public.is_event_admin(vb.event_id)
          OR EXISTS (
            SELECT 1
            FROM public.event_members em
            WHERE em.event_id = vb.event_id
              AND em.user_id = auth.uid()
              AND (
                em.role = 'vendor'
                OR (em.roles IS NOT NULL AND 'vendor' = ANY (em.roles))
              )
          )
        )
    )
  );

DROP POLICY IF EXISTS "Admins can assign meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings
  FOR INSERT WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE ms.id = meeting_bookings.slot_id
        AND public.is_event_admin(vb.event_id)
    )
  );

DROP POLICY IF EXISTS "Admins can update meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE ms.id = meeting_bookings.slot_id
        AND public.is_event_admin(vb.event_id)
    )
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE ms.id = meeting_bookings.slot_id
        AND public.is_event_admin(vb.event_id)
    )
  );

DROP POLICY IF EXISTS "Vendors manage slots" ON public.meeting_slots;
CREATE POLICY "Vendors manage slots" ON public.meeting_slots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_booths vb
      WHERE vb.id = meeting_slots.booth_id
        AND (
          public.is_event_admin(vb.event_id)
          OR EXISTS (
            SELECT 1
            FROM public.event_members em
            WHERE em.event_id = vb.event_id
              AND em.user_id = auth.uid()
              AND (
                em.role = 'vendor'
                OR (em.roles IS NOT NULL AND 'vendor' = ANY (em.roles))
              )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendor_booths vb
      WHERE vb.id = meeting_slots.booth_id
        AND (
          public.is_event_admin(vb.event_id)
          OR EXISTS (
            SELECT 1
            FROM public.event_members em
            WHERE em.event_id = vb.event_id
              AND em.user_id = auth.uid()
              AND (
                em.role = 'vendor'
                OR (em.roles IS NOT NULL AND 'vendor' = ANY (em.roles))
              )
          )
        )
    )
  );
