-- Include cancelled bookings so admin UI can show them in a separate section at the bottom.

CREATE OR REPLACE FUNCTION public.admin_list_booth_meeting_bookings(p_booth_id UUID)
RETURNS TABLE (
  booking_id UUID,
  slot_id UUID,
  attendee_id UUID,
  status TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mb.id,
    mb.slot_id,
    mb.attendee_id,
    mb.status,
    ms.start_time,
    ms.end_time
  FROM public.meeting_bookings mb
  INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
  INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
  WHERE ms.booth_id = p_booth_id
    AND (
      public.is_platform_admin(auth.uid())
      OR public.is_event_admin(vb.event_id)
    )
  ORDER BY ms.start_time ASC;
$$;

COMMENT ON FUNCTION public.admin_list_booth_meeting_bookings(UUID) IS
  'Admin UI: list meeting bookings for a vendor booth including cancelled (definer read; gated by is_platform_admin / is_event_admin).';
