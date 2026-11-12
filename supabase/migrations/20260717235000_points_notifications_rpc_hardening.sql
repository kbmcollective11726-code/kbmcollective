-- Remove broad client writes and derive point awards inside the database.

CREATE OR REPLACE FUNCTION public.award_points_secure(
  p_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_reference_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid;
  v_points integer;
  v_max_per_day integer;
  v_image_hash text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_account_active(v_actor) THEN
    RAISE EXCEPTION 'Active authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Event membership required' USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'post_photo' THEN
      SELECT user_id, image_hash INTO v_target, v_image_hash
      FROM public.posts
      WHERE id = p_reference_id AND event_id = p_event_id AND is_deleted = false;
      IF v_target IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Invalid point proof'; END IF;
      IF v_image_hash IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.posts
        WHERE event_id = p_event_id AND user_id = v_actor
          AND image_hash = v_image_hash AND id <> p_reference_id AND is_deleted = false
      ) THEN RETURN jsonb_build_object('awarded', false, 'points', 0); END IF;
    WHEN 'give_like' THEN
      v_target := v_actor;
      IF NOT EXISTS (
        SELECT 1 FROM public.likes l JOIN public.posts p ON p.id = l.post_id
        WHERE l.post_id = p_reference_id AND l.user_id = v_actor
          AND p.event_id = p_event_id AND p.user_id <> v_actor
      ) THEN RAISE EXCEPTION 'Invalid point proof'; END IF;
    WHEN 'receive_like' THEN
      SELECT p.user_id INTO v_target
      FROM public.likes l JOIN public.posts p ON p.id = l.post_id
      WHERE l.id = p_reference_id AND l.user_id = v_actor
        AND p.event_id = p_event_id AND p.user_id = p_user_id;
    WHEN 'comment' THEN
      SELECT c.user_id INTO v_target
      FROM public.comments c JOIN public.posts p ON p.id = c.post_id
      WHERE c.id = p_reference_id AND c.user_id = v_actor
        AND p.event_id = p_event_id AND p.user_id <> v_actor;
    WHEN 'receive_comment' THEN
      SELECT p.user_id INTO v_target
      FROM public.comments c JOIN public.posts p ON p.id = c.post_id
      WHERE c.id = p_reference_id AND c.user_id = v_actor
        AND p.event_id = p_event_id AND p.user_id = p_user_id;
    WHEN 'give_comment_like' THEN
      v_target := v_actor;
      IF NOT EXISTS (
        SELECT 1
        FROM public.comment_likes cl
        JOIN public.comments c ON c.id = cl.comment_id
        JOIN public.posts p ON p.id = c.post_id
        WHERE cl.comment_id = p_reference_id AND cl.user_id = v_actor
          AND p.event_id = p_event_id AND c.user_id <> v_actor
      ) THEN RAISE EXCEPTION 'Invalid point proof'; END IF;
    WHEN 'receive_comment_like' THEN
      SELECT c.user_id INTO v_target
      FROM public.comment_likes cl
      JOIN public.comments c ON c.id = cl.comment_id
      JOIN public.posts p ON p.id = c.post_id
      WHERE cl.id = p_reference_id AND cl.user_id = v_actor
        AND p.event_id = p_event_id AND c.user_id = p_user_id;
    WHEN 'connect' THEN
      v_target := v_actor;
      IF p_reference_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Invalid point proof'; END IF;
    WHEN 'session_feedback' THEN
      SELECT user_id INTO v_target FROM public.session_ratings
      WHERE id = p_reference_id AND event_id = p_event_id AND user_id = v_actor;
    WHEN 'b2b_feedback' THEN
      SELECT f.user_id INTO v_target
      FROM public.b2b_meeting_feedback f
      JOIN public.meeting_bookings b ON b.id = f.booking_id
      JOIN public.meeting_slots s ON s.id = b.slot_id
      JOIN public.vendor_booths vb ON vb.id = s.booth_id
      WHERE b.id = p_reference_id AND f.user_id = v_actor AND vb.event_id = p_event_id;
    WHEN 'vendor_meeting' THEN
      SELECT b.attendee_id INTO v_target
      FROM public.meeting_bookings b
      JOIN public.meeting_slots s ON s.id = b.slot_id
      JOIN public.vendor_booths vb ON vb.id = s.booth_id
      WHERE b.id = p_reference_id AND vb.event_id = p_event_id
        AND (vb.contact_user_id = v_actor OR public.is_event_admin(p_event_id));
    ELSE
      RAISE EXCEPTION 'Unsupported point action';
  END CASE;

  IF v_target IS NULL OR v_target IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Invalid point recipient' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Recipient is not an event member' USING ERRCODE = '42501';
  END IF;

  SELECT points_value, max_per_day INTO v_points, v_max_per_day
  FROM public.point_rules
  WHERE event_id = p_event_id AND action = p_action;
  IF v_points IS NULL THEN RETURN jsonb_build_object('awarded', false, 'points', 0); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_user_id, p_event_id, p_action, p_reference_id), 0
  ));
  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.point_log
    WHERE user_id = p_user_id AND event_id = p_event_id
      AND action = p_action AND reference_id = p_reference_id
  ) THEN RETURN jsonb_build_object('awarded', false, 'points', 0); END IF;
  IF v_max_per_day IS NOT NULL AND (
    SELECT count(*) FROM public.point_log
    WHERE user_id = p_user_id AND event_id = p_event_id AND action = p_action
      AND created_at >= date_trunc('day', now())
  ) >= v_max_per_day THEN
    RETURN jsonb_build_object('awarded', false, 'points', 0);
  END IF;

  INSERT INTO public.point_log (
    user_id, event_id, action, points, reference_id, description
  ) VALUES (
    p_user_id, p_event_id, p_action, v_points, p_reference_id,
    COALESCE(NULLIF(trim(p_description), ''), replace(p_action, '_', ' '))
  );
  RETURN jsonb_build_object('awarded', true, 'points', v_points);
END;
$$;

REVOKE ALL ON FUNCTION public.award_points_secure(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_points_secure(uuid, uuid, text, uuid, text)
  TO authenticated;

DROP POLICY IF EXISTS "System can log points" ON public.point_log;
REVOKE INSERT ON public.point_log FROM anon, authenticated;

DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
CREATE POLICY notification_event_participants_insert
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_event_admin(event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
    OR (
      event_id IS NOT NULL
      AND user_id <> (SELECT auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.event_members mine
        WHERE mine.event_id = notifications.event_id
          AND mine.user_id = (SELECT auth.uid())
      )
      AND EXISTS (
        SELECT 1 FROM public.event_members recipient
        WHERE recipient.event_id = notifications.event_id
          AND recipient.user_id = notifications.user_id
      )
    )
  );

DROP POLICY IF EXISTS "Service role can manage session_reminder_sent"
  ON public.session_reminder_sent;
REVOKE ALL ON public.session_reminder_sent FROM anon, authenticated;

-- Trigger functions never need direct RPC execution.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END
$$;

-- This hook must execute for anon requests, but does not need definer rights.
ALTER FUNCTION public.enforce_active_postgrest_request() SECURITY INVOKER;
