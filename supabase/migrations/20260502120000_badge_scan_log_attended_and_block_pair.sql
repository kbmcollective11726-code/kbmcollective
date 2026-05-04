-- 1) Scan log / RPC: attended_meeting must reflect badge_scan_meeting_attendance (same logic as vendorScanRowShowsAttended).
-- 2) Pair blocking: either direction blocks new connection requests, connection rows, and messages.

CREATE OR REPLACE FUNCTION public.users_have_block (a uuid, b uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = a AND bu.blocked_user_id = b)
       OR (bu.blocker_id = b AND bu.blocked_user_id = a)
  );
$$;

REVOKE ALL ON FUNCTION public.users_have_block (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_have_block (uuid, uuid) TO authenticated;

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
      CASE WHEN bs.meeting_booking_id IS NULL THEN NULL::jsonb
      WHEN mb.id IS NULL THEN jsonb_build_object('id', bs.meeting_booking_id, 'label', 'Meeting (details unavailable)')
      ELSE jsonb_build_object('id', mb.id, 'label', coalesce(vb.vendor_name, '') || ' · ' || coalesce(to_char(ms.start_time, 'Mon DD, HH12:MI PM'), ''))
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
    WHERE bs.event_id = p_event_id
  ) q;
  RETURN jsonb_build_object('rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_badge_scans (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_badge_scans (uuid) TO authenticated;

-- See inbound blocks (who blocked me) for client UX; still only delete rows where I am blocker.
DROP POLICY IF EXISTS "Users can view own blocks" ON public.blocked_users;
CREATE POLICY "Users can view blocks they are party to" ON public.blocked_users FOR SELECT
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_user_id);

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id
  AND NOT public.users_have_block(sender_id, receiver_id)
);

DROP POLICY IF EXISTS "Users can connect" ON public.connections;
CREATE POLICY "Users can connect" ON public.connections FOR INSERT WITH CHECK (
  (auth.uid() = user_id OR auth.uid() = connected_user_id)
  AND NOT public.users_have_block(user_id, connected_user_id)
);

DROP POLICY IF EXISTS "Users can send connection request" ON public.connection_requests;
CREATE POLICY "Users can send connection request" ON public.connection_requests FOR INSERT WITH CHECK (
  auth.uid() = requester_id
  AND NOT public.users_have_block(requester_id, requested_user_id)
);

DROP POLICY IF EXISTS "Requested user can update request" ON public.connection_requests;
CREATE POLICY "Requested user can update request" ON public.connection_requests FOR UPDATE
  USING (auth.uid() = requested_user_id)
  WITH CHECK (
    auth.uid() = requested_user_id
    AND (
      status IS DISTINCT FROM 'accepted'
      OR NOT public.users_have_block(requester_id, requested_user_id)
    )
  );
