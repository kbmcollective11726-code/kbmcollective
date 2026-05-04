-- Scan log "1:1 meeting" column: when badge_scans.meeting_booking_id is null but per-meeting rows exist,
-- show vendor · slot labels from badge_scan_meeting_attendance (attended only).

CREATE OR REPLACE FUNCTION public.list_event_badge_scans (p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT jsonb_build_object(
      'id', bs.id,
      'scanner_kind', bs.scanner_kind,
      'attended_meeting', (
        EXISTS (
          SELECT 1
          FROM public.badge_scan_meeting_attendance bma
          WHERE bma.event_id = bs.event_id
            AND bma.scanner_user_id = bs.scanner_user_id
            AND bma.subject_user_id = bs.subject_user_id
            AND bma.attended_meeting IS TRUE
        )
        OR (
          COALESCE(bs.attended_meeting, FALSE)
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public.badge_scan_meeting_attendance bma2
              WHERE bma2.event_id = bs.event_id
                AND bma2.scanner_user_id = bs.scanner_user_id
                AND bma2.subject_user_id = bs.subject_user_id
            )
            OR bs.meeting_booking_id IS NULL
          )
        )
      ),
      'note', bs.note,
      'meeting',
      CASE
        WHEN bs.meeting_booking_id IS NOT NULL THEN
          CASE
            WHEN mb.id IS NULL THEN jsonb_build_object('id', bs.meeting_booking_id, 'label', 'Meeting (details unavailable)')
            ELSE jsonb_build_object(
              'id', mb.id,
              'label', coalesce(vb.vendor_name, '') || ' · ' || coalesce(to_char(ms.start_time, 'Mon DD, HH12:MI PM'), '')
            )
          END
        WHEN coalesce(msum.n, 0) >= 1 THEN
          CASE
            WHEN msum.n = 1 THEN jsonb_build_object('id', msum.one_id, 'label', nullif(trim(msum.all_labels), ''))
            ELSE jsonb_build_object('id', null, 'label', nullif(trim(msum.all_labels), ''))
          END
        ELSE NULL::jsonb
      END,
      'created_at', bs.created_at,
      'updated_at', bs.updated_at,
      'scanner', jsonb_build_object('user_id', su.id, 'full_name', coalesce(su.full_name, ''), 'email', coalesce(su.email, '')),
      'subject', jsonb_build_object('user_id', subj.id, 'full_name', coalesce(subj.full_name, ''), 'email', coalesce(subj.email, ''), 'company', coalesce(subj.company, ''))
    ) AS x, bs.updated_at AS ord
    FROM public.badge_scans bs
    JOIN public.users su ON su.id = bs.scanner_user_id
    JOIN public.users subj ON subj.id = bs.subject_user_id
    LEFT JOIN public.meeting_bookings mb ON mb.id = bs.meeting_booking_id
    LEFT JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    LEFT JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS n,
        string_agg(
          coalesce(vb_x.vendor_name, '') || ' · ' || coalesce(to_char(ms_x.start_time, 'Mon DD, HH12:MI PM'), ''),
          '; ' ORDER BY ms_x.start_time
        ) AS all_labels,
        (array_agg(mb_x.id ORDER BY ms_x.start_time))[1] AS one_id
      FROM public.badge_scan_meeting_attendance bma_x
      INNER JOIN public.meeting_bookings mb_x ON mb_x.id = bma_x.meeting_booking_id
      INNER JOIN public.meeting_slots ms_x ON ms_x.id = mb_x.slot_id
      INNER JOIN public.vendor_booths vb_x ON vb_x.id = ms_x.booth_id
      WHERE bma_x.event_id = bs.event_id
        AND bma_x.scanner_user_id = bs.scanner_user_id
        AND bma_x.subject_user_id = bs.subject_user_id
        AND bma_x.attended_meeting IS TRUE
    ) msum ON true
    WHERE bs.event_id = p_event_id
  ) q;
  RETURN jsonb_build_object('rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_badge_scans (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_badge_scans (uuid) TO authenticated;
