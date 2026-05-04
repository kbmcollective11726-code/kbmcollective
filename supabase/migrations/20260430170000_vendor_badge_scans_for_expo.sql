-- Vendor-facing list of badge scans for the 1:1 Meetings screen.
-- Returns latest scan rows captured by the signed-in vendor rep at this event.
CREATE OR REPLACE FUNCTION public.list_vendor_badge_scans_for_event (
  p_event_id uuid,
  p_subject_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_event');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.vendor_booths vb
    WHERE vb.event_id = p_event_id
      AND vb.is_active = true
      AND (
        vb.contact_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.vendor_booth_reps vbr
          WHERE vbr.booth_id = vb.id AND vbr.user_id = auth.uid()
        )
      )
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', bs.id,
        'subject_user_id', su.id,
        'subject_name', coalesce(su.full_name, ''),
        'subject_company', coalesce(su.company, ''),
        'attended_meeting', bs.attended_meeting,
        'note', coalesce(bs.note, ''),
        'meeting_booking_id', bs.meeting_booking_id,
        'meeting_label',
          CASE
            WHEN mb.id IS NULL THEN NULL
            ELSE coalesce(vb.vendor_name, '') || ' · ' || coalesce(to_char(ms.start_time, 'Mon DD, HH12:MI PM'), '')
          END,
        'updated_at', bs.updated_at
      )
      ORDER BY bs.updated_at DESC
    ),
    '[]'::jsonb
  ) INTO rows
  FROM public.badge_scans bs
  JOIN public.users su ON su.id = bs.subject_user_id
  LEFT JOIN public.meeting_bookings mb ON mb.id = bs.meeting_booking_id
  LEFT JOIN public.meeting_slots ms ON ms.id = mb.slot_id
  LEFT JOIN public.vendor_booths vb ON vb.id = ms.booth_id
  WHERE bs.event_id = p_event_id
    AND bs.scanner_user_id = auth.uid()
    AND bs.scanner_kind = 'vendor'
    AND (
      p_subject_ids IS NULL
      OR cardinality(p_subject_ids) = 0
      OR bs.subject_user_id = ANY(p_subject_ids)
    );

  RETURN jsonb_build_object('rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_vendor_badge_scans_for_event (uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_vendor_badge_scans_for_event (uuid, uuid[]) TO authenticated;
