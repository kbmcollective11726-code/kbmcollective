-- Hidden support members (auto-joined to every event, invisible to attendees),
-- event readiness check for event admins, and platform health snapshot for platform admins.

-- ---------------------------------------------------------------------------
-- 1) Hidden members + auto-join accounts
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Not granted to clients (users has column-level grants); set by platform staff in SQL.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auto_join_all_events boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_event_member_hidden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('app.support_auto_join', true), '') = 'on'
     OR auth.uid() IS NULL
     OR public.is_platform_admin(auth.uid()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_hidden THEN
      RAISE EXCEPTION 'Only platform admins can add hidden members' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden
       OR (OLD.is_hidden AND (
         NEW.role IS DISTINCT FROM OLD.role
         OR NEW.roles IS DISTINCT FROM OLD.roles
         OR NEW.is_active IS DISTINCT FROM OLD.is_active
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.event_id IS DISTINCT FROM OLD.event_id
       )) THEN
      RAISE EXCEPTION 'The KBM support account is managed by platform admins' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSE
    -- Cascades from deleting the event or the user are allowed.
    IF OLD.is_hidden AND pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'The KBM support account is managed by platform admins' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS guard_event_member_hidden ON public.event_members;
CREATE TRIGGER guard_event_member_hidden
  BEFORE INSERT OR UPDATE OR DELETE ON public.event_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_member_hidden();

CREATE OR REPLACE FUNCTION public.auto_join_support_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.support_auto_join', 'on', true);
  INSERT INTO public.event_members (event_id, user_id, role, roles, is_hidden, is_active)
  SELECT NEW.id, u.id, 'admin', ARRAY['admin']::text[], true, true
  FROM public.users u
  WHERE u.auto_join_all_events = true
    AND u.is_active IS NOT FALSE
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET role = 'admin', roles = ARRAY['admin']::text[], is_hidden = true, is_active = true;
  PERFORM set_config('app.support_auto_join', 'off', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_join_support_accounts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_event_member_hidden() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auto_join_support_accounts_after_insert ON public.events;
CREATE TRIGGER auto_join_support_accounts_after_insert
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.auto_join_support_accounts();

-- Attendees never see hidden members; event admins, platform admins, and the member themself do.
DROP POLICY IF EXISTS event_members_select_perm ON public.event_members;
CREATE POLICY event_members_select_perm ON public.event_members
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(event_id)
    OR (
      public.is_event_member(event_id)
      AND (NOT is_hidden OR user_id = (SELECT auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.get_live_wall_leaderboard(p_event_id uuid, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 25));
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'user_id', em.user_id,
            'points', em.points,
            'users', jsonb_build_object(
              'full_name', u.full_name,
              'avatar_url', u.avatar_url,
              'title', u.title
            )
          ) AS row_data,
          ROW_NUMBER() OVER (ORDER BY em.points DESC NULLS LAST) AS ord
        FROM public.event_members em
        INNER JOIN public.users u ON u.id = em.user_id
        WHERE em.event_id = p_event_id
          AND NOT em.is_hidden
        ORDER BY em.points DESC NULLS LAST
        LIMIT v_limit
      ) q
    ),
    '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_wall_member_count(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT COUNT(*)::integer
    FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND NOT em.is_hidden
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Event readiness check (event admins + platform admins)
-- Meeting and session times are venue wall-clock digits stored as UTC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.readiness_event_bookings(p_event_id uuid)
RETURNS TABLE (
  booking_id uuid, attendee_id uuid, booked_at timestamptz, booth_id uuid,
  vendor_name text, st timestamp, en timestamp
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT mb.id, mb.attendee_id, mb.created_at, ms.booth_id, vb.vendor_name,
         ms.start_time AT TIME ZONE 'UTC',
         COALESCE(ms.end_time, ms.start_time + interval '30 minutes') AT TIME ZONE 'UTC'
  FROM public.meeting_bookings mb
  JOIN public.meeting_slots ms ON ms.id = mb.slot_id
  JOIN public.vendor_booths vb ON vb.id = ms.booth_id
  WHERE vb.event_id = p_event_id AND mb.status <> 'cancelled';
$$;

REVOKE ALL ON FUNCTION public.readiness_event_bookings(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_event_readiness(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e public.events%ROWTYPE;
  v_tz text;
  v_tz_set boolean;
  v_now_local timestamp;
  v_today date;
  v_phase text;
  v_phase_label text;
  v_checks jsonb := '[]'::jsonb;
  v_items jsonb;
  v_n int;
  v_m int;
  v_k int;
  v_total int;
  v_signed int;
  v_push int;
  v_meetings_total int;
  v_meetings_today int;
  v_meetings_upcoming int;
  v_sessions int;
  v_status text;
  v_overall text := 'ok';
  v_paused boolean;
  v_menu_1on1 boolean;
  v_menu_agenda boolean;
  v_job record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.is_event_admin(p_event_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_tz := NULLIF(trim(COALESCE(e.reminder_timezone, '')), '');
  v_tz_set := v_tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz);
  IF NOT v_tz_set THEN
    v_tz := 'America/New_York';
  END IF;
  v_now_local := now() AT TIME ZONE v_tz;
  v_today := v_now_local::date;

  IF v_today < e.start_date THEN
    v_phase := 'upcoming';
    v_phase_label := 'Starts in ' || (e.start_date - v_today) || ' day' || CASE WHEN e.start_date - v_today = 1 THEN '' ELSE 's' END;
  ELSIF v_today <= e.end_date THEN
    v_phase := 'live';
    v_phase_label := 'Live today — day ' || (v_today - e.start_date + 1) || ' of ' || (e.end_date - e.start_date + 1);
  ELSE
    v_phase := 'ended';
    v_phase_label := 'Ended ' || (v_today - e.end_date) || ' day' || CASE WHEN v_today - e.end_date = 1 THEN '' ELSE 's' END || ' ago';
  END IF;

  -- Setup ------------------------------------------------------------------
  v_checks := v_checks || jsonb_build_object(
    'id', 'event_active', 'group', 'Setup', 'label', 'Event is turned on',
    'status', CASE WHEN e.is_active IS NOT FALSE THEN 'ok' WHEN v_phase = 'ended' THEN 'info' ELSE 'fail' END,
    'detail', CASE WHEN e.is_active IS NOT FALSE THEN 'Attendees can open this event in the app.'
                   ELSE 'The event is turned off, so attendees cannot open it in the app.' END);

  v_checks := v_checks || jsonb_build_object(
    'id', 'timezone', 'group', 'Setup', 'label', 'Time zone',
    'status', CASE WHEN v_tz_set THEN 'ok' ELSE 'warn' END,
    'detail', CASE WHEN v_tz_set THEN 'Reminders use ' || v_tz || '. Venue time now: ' || to_char(v_now_local, 'Dy Mon DD, HH12:MI AM') || '.'
                   ELSE 'No time zone is set on the event, so reminders use Eastern time. Set it on Edit event if the venue is elsewhere.' END);

  SELECT count(*) INTO v_n FROM unnest(ARRAY[e.logo_url, e.banner_url]) x WHERE NULLIF(trim(COALESCE(x, '')), '') IS NULL;
  v_checks := v_checks || jsonb_build_object(
    'id', 'branding', 'group', 'Setup', 'label', 'Logo and banner',
    'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
    'detail', CASE WHEN v_n = 0 THEN 'Logo and banner are set.'
                   WHEN NULLIF(trim(COALESCE(e.logo_url, '')), '') IS NULL AND NULLIF(trim(COALESCE(e.banner_url, '')), '') IS NULL THEN 'No logo or banner is set.'
                   WHEN NULLIF(trim(COALESCE(e.logo_url, '')), '') IS NULL THEN 'No logo is set.'
                   ELSE 'No banner is set.' END);

  v_paused := e.notifications_paused = true AND (e.notifications_paused_until IS NULL OR e.notifications_paused_until > now());
  v_checks := v_checks || jsonb_build_object(
    'id', 'notifications_on', 'group', 'Notifications', 'label', 'Notifications are on',
    'status', CASE WHEN NOT v_paused THEN 'ok' WHEN v_phase = 'ended' THEN 'info' ELSE 'warn' END,
    'detail', CASE WHEN NOT v_paused THEN 'Reminders and alerts will be sent.'
                   WHEN e.notifications_paused_until IS NULL THEN 'Notifications are paused until someone turns them back on.'
                   ELSE 'Notifications are paused until ' || to_char(e.notifications_paused_until AT TIME ZONE v_tz, 'Dy Mon DD, HH12:MI AM') || ' (venue time).' END);

  -- Attendees --------------------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE u.last_login_at IS NOT NULL),
         count(*) FILTER (WHERE NULLIF(trim(COALESCE(u.push_token, '')), '') IS NOT NULL)
    INTO v_total, v_signed, v_push
  FROM public.event_members em
  JOIN public.users u ON u.id = em.user_id
  WHERE em.event_id = p_event_id
    AND COALESCE(em.is_active, true)
    AND NOT em.is_hidden
    AND u.is_active IS NOT FALSE;

  v_checks := v_checks || jsonb_build_object(
    'id', 'members', 'group', 'Attendees', 'label', 'Members added',
    'status', CASE WHEN v_total > 0 THEN 'ok' WHEN v_phase = 'ended' THEN 'info' ELSE 'fail' END,
    'detail', v_total || ' active member' || CASE WHEN v_total = 1 THEN '' ELSE 's' END || '.');

  IF v_total > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'signed_in', 'group', 'Attendees', 'label', 'Signed in to the app',
      'status', CASE WHEN v_signed * 100 >= v_total * 75 OR v_phase = 'ended' THEN 'ok' ELSE 'warn' END,
      'detail', v_signed || ' of ' || v_total || ' (' || round(v_signed * 100.0 / v_total) || '%) have signed in at least once.'
        || CASE WHEN v_signed * 100 < v_total * 75 AND v_phase <> 'ended' THEN ' Remind attendees to download the app and sign in.' ELSE '' END);

    v_checks := v_checks || jsonb_build_object(
      'id', 'push_enabled', 'group', 'Attendees', 'label', 'Can receive push alerts',
      'status', CASE WHEN v_push * 100 >= v_total * 60 OR v_phase = 'ended' THEN 'ok' ELSE 'warn' END,
      'detail', v_push || ' of ' || v_total || ' (' || round(v_push * 100.0 / v_total) || '%) allowed notifications on their phone.'
        || CASE WHEN v_push * 100 < v_total * 60 AND v_phase <> 'ended' THEN ' Ask attendees to open the app and allow notifications.' ELSE '' END);
  END IF;

  -- Agenda -----------------------------------------------------------------
  v_menu_agenda := e.platform_menu_show_agenda = true AND e.menu_show_agenda IS NOT FALSE;
  SELECT count(*) INTO v_sessions FROM public.schedule_sessions s WHERE s.event_id = p_event_id AND s.is_active IS NOT FALSE;

  v_checks := v_checks || jsonb_build_object(
    'id', 'sessions', 'group', 'Agenda', 'label', 'Agenda sessions',
    'status', CASE WHEN v_sessions > 0 AND NOT v_menu_agenda THEN 'warn'
                   WHEN v_sessions = 0 AND v_menu_agenda AND v_phase <> 'ended' THEN 'warn'
                   ELSE 'ok' END,
    'detail', v_sessions || ' session' || CASE WHEN v_sessions = 1 THEN '' ELSE 's' END || '.'
      || CASE WHEN v_sessions > 0 AND NOT v_menu_agenda THEN ' The Agenda menu is hidden in the app, so attendees cannot see them.'
              WHEN v_sessions = 0 AND v_menu_agenda AND v_phase <> 'ended' THEN ' The Agenda menu is on but has no sessions yet.'
              ELSE '' END);

  SELECT count(*), COALESCE(jsonb_agg(x) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
  FROM (
    SELECT s.title || ' — starts ' || to_char(s.start_time AT TIME ZONE 'UTC', 'Dy Mon DD HH12:MI AM')
             || ', ends ' || to_char(s.end_time AT TIME ZONE 'UTC', 'Dy Mon DD HH12:MI AM') AS x,
           row_number() OVER (ORDER BY s.start_time) AS rn
    FROM public.schedule_sessions s
    WHERE s.event_id = p_event_id AND s.is_active IS NOT FALSE
      AND s.end_time IS NOT NULL AND s.end_time <= s.start_time
  ) q;
  IF v_sessions > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'session_times', 'group', 'Agenda', 'label', 'Session end times',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'Every session ends after it starts.'
                     ELSE v_n || ' session' || CASE WHEN v_n = 1 THEN ' ends' ELSE 's end' END || ' before or when it starts. Fix the end time in Schedule.' END,
      'items', v_items);
  END IF;

  SELECT count(*), COALESCE(jsonb_agg(x) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
  FROM (
    SELECT s.title || ' — ' || to_char(s.start_time AT TIME ZONE 'UTC', 'Dy Mon DD') AS x,
           row_number() OVER (ORDER BY s.start_time) AS rn
    FROM public.schedule_sessions s
    WHERE s.event_id = p_event_id AND s.is_active IS NOT FALSE
      AND (s.start_time AT TIME ZONE 'UTC')::date NOT BETWEEN e.start_date AND e.end_date
  ) q;
  IF v_sessions > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'session_dates', 'group', 'Agenda', 'label', 'Sessions within event dates',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'All sessions fall on event days.'
                     ELSE v_n || ' session' || CASE WHEN v_n = 1 THEN ' is' ELSE 's are' END || ' outside the event dates.' END,
      'items', v_items);
  END IF;

  -- 1:1 meetings -----------------------------------------------------------
  SELECT count(*), count(*) FILTER (WHERE b.st::date = v_today), count(*) FILTER (WHERE b.st > v_now_local)
    INTO v_meetings_total, v_meetings_today, v_meetings_upcoming
  FROM public.readiness_event_bookings(p_event_id) b;

  v_menu_1on1 := e.platform_menu_show_1on1 = true AND e.menu_show_1on1 IS NOT FALSE;
  v_checks := v_checks || jsonb_build_object(
    'id', 'meetings', 'group', '1:1 Meetings', 'label', '1:1 meetings',
    'status', CASE WHEN v_meetings_upcoming > 0 AND NOT v_menu_1on1 THEN 'warn' ELSE 'ok' END,
    'detail', v_meetings_total || ' meeting' || CASE WHEN v_meetings_total = 1 THEN '' ELSE 's' END || ' total, '
      || v_meetings_today || ' today, ' || v_meetings_upcoming || ' still to come.'
      || CASE WHEN v_meetings_upcoming > 0 AND NOT v_menu_1on1 THEN ' The 1:1 Meetings menu is hidden in the app, so attendees cannot see them.' ELSE '' END);

  IF v_meetings_upcoming > 0 THEN
    -- Booths with upcoming meetings and no linked rep.
    SELECT count(*), COALESCE(jsonb_agg(vendor_name ORDER BY vendor_name) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
    FROM (
      SELECT DISTINCT b.vendor_name, dense_rank() OVER (ORDER BY b.vendor_name) AS rn
      FROM public.readiness_event_bookings(p_event_id) b
      JOIN public.vendor_booths vb ON vb.id = b.booth_id
      WHERE b.en > v_now_local
        AND vb.contact_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = b.booth_id)
    ) q;
    v_checks := v_checks || jsonb_build_object(
      'id', 'booth_reps', 'group', '1:1 Meetings', 'label', 'Every booth with meetings has a rep',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'fail' END,
      'detail', CASE WHEN v_n = 0 THEN 'Every booth with upcoming meetings has at least one representative.'
                     ELSE v_n || ' booth' || CASE WHEN v_n = 1 THEN ' has' ELSE 's have' END || ' meetings but no representative, so nobody from the vendor gets the reminder.' END,
      'items', v_items);

    -- Booths with more overlapping meetings than reps.
    WITH bk AS (
      SELECT * FROM public.readiness_event_bookings(p_event_id)
    ), hits AS (
      SELECT DISTINCT ON (b1.booth_id, b1.st)
             b1.vendor_name || ' — ' || to_char(b1.st, 'Dy Mon DD HH12:MI AM') || ': ' || ov.cnt || ' meetings, '
               || reps.cnt || ' rep' || CASE WHEN reps.cnt = 1 THEN '' ELSE 's' END AS x,
             b1.st
      FROM bk b1
      CROSS JOIN LATERAL (
        SELECT count(*) AS cnt FROM bk b2
        WHERE b2.booth_id = b1.booth_id AND b2.st < b1.en AND b2.en > b1.st
      ) ov
      CROSS JOIN LATERAL (
        SELECT GREATEST(count(DISTINCT uid), 1) AS cnt FROM (
          SELECT r.user_id AS uid FROM public.vendor_booth_reps r WHERE r.booth_id = b1.booth_id
          UNION SELECT vb.contact_user_id FROM public.vendor_booths vb WHERE vb.id = b1.booth_id AND vb.contact_user_id IS NOT NULL
        ) u
      ) reps
      WHERE b1.en > v_now_local AND ov.cnt > reps.cnt
      ORDER BY b1.booth_id, b1.st
    )
    SELECT count(*), COALESCE(jsonb_agg(x ORDER BY st) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
    FROM (SELECT x, st, row_number() OVER (ORDER BY st) AS rn FROM hits) q;
    v_checks := v_checks || jsonb_build_object(
      'id', 'booth_overbooked', 'group', '1:1 Meetings', 'label', 'Booths not double-booked',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'No booth has more meetings at the same time than it has reps.'
                     ELSE v_n || ' time' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' where a booth has more meetings at once than reps.' END,
      'items', v_items);

    -- Attendees in two meetings at once.
    SELECT count(*), COALESCE(jsonb_agg(x ORDER BY st) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
    FROM (
      SELECT COALESCE(NULLIF(trim(u.full_name), ''), 'An attendee') || ' — ' || b1.vendor_name || ' and ' || b2.vendor_name
               || ' at ' || to_char(b1.st, 'Dy Mon DD HH12:MI AM') AS x,
             b1.st,
             row_number() OVER (ORDER BY b1.st) AS rn
      FROM public.readiness_event_bookings(p_event_id) b1
      JOIN public.readiness_event_bookings(p_event_id) b2 ON b2.attendee_id = b1.attendee_id AND b2.booking_id > b1.booking_id
        AND b2.st < b1.en AND b2.en > b1.st
      LEFT JOIN public.users u ON u.id = b1.attendee_id
      WHERE b1.en > v_now_local
    ) q;
    v_checks := v_checks || jsonb_build_object(
      'id', 'attendee_double', 'group', '1:1 Meetings', 'label', 'No attendee double-booked',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'No attendee has two meetings at the same time.'
                     ELSE v_n || ' attendee conflict' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' found.' END,
      'items', v_items);

    -- Meeting attendees who are not active members of this event.
    SELECT count(DISTINCT b.attendee_id),
           COALESCE(jsonb_agg(DISTINCT COALESCE(NULLIF(trim(u.full_name), ''), 'Unknown attendee')), '[]'::jsonb)
      INTO v_n, v_items
    FROM public.readiness_event_bookings(p_event_id) b
    LEFT JOIN public.users u ON u.id = b.attendee_id
    WHERE b.en > v_now_local
      AND NOT EXISTS (
        SELECT 1 FROM public.event_members em
        WHERE em.event_id = p_event_id AND em.user_id = b.attendee_id AND COALESCE(em.is_active, true)
      );
    v_checks := v_checks || jsonb_build_object(
      'id', 'meeting_members', 'group', '1:1 Meetings', 'label', 'Meeting attendees are event members',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'Everyone with an upcoming meeting is an active member of this event.'
                     ELSE v_n || ' attendee' || CASE WHEN v_n = 1 THEN ' has' ELSE 's have' END || ' meetings but ' || CASE WHEN v_n = 1 THEN 'is' ELSE 'are' END || ' not active members, so they cannot see them.' END,
      'items', CASE WHEN jsonb_array_length(v_items) > 10 THEN (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(v_items) x LIMIT 10) q) ELSE v_items END);

    SELECT count(*), COALESCE(jsonb_agg(x ORDER BY st) FILTER (WHERE rn <= 10), '[]'::jsonb) INTO v_n, v_items
    FROM (
      SELECT b.vendor_name || ' — ' || to_char(b.st, 'Dy Mon DD HH12:MI AM') AS x, b.st,
             row_number() OVER (ORDER BY b.st) AS rn
      FROM public.readiness_event_bookings(p_event_id) b
      WHERE b.en > v_now_local AND b.st::date NOT BETWEEN e.start_date AND e.end_date
    ) q;
    v_checks := v_checks || jsonb_build_object(
      'id', 'meeting_dates', 'group', '1:1 Meetings', 'label', 'Meetings within event dates',
      'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'warn' END,
      'detail', CASE WHEN v_n = 0 THEN 'All upcoming meetings fall on event days.'
                     ELSE v_n || ' upcoming meeting' || CASE WHEN v_n = 1 THEN ' is' ELSE 's are' END || ' outside the event dates.' END,
      'items', v_items);
  END IF;

  -- Notifications delivered -------------------------------------------------
  -- Meetings that started at least 10 minutes ago and were booked well before their start.
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.b2b_meeting_reminder_sent s WHERE s.booking_id = b.booking_id)),
         COALESCE(jsonb_agg(b.vendor_name || ' — ' || COALESCE(NULLIF(trim(u.full_name), ''), 'attendee') || ' at ' || to_char(b.st, 'Dy Mon DD HH12:MI AM') ORDER BY b.st DESC)
           FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.b2b_meeting_reminder_sent s WHERE s.booking_id = b.booking_id)), '[]'::jsonb)
    INTO v_m, v_k, v_items
  FROM public.readiness_event_bookings(p_event_id) b
  LEFT JOIN public.users u ON u.id = b.attendee_id
  WHERE b.st <= v_now_local - interval '10 minutes'
    AND b.st >= GREATEST(e.start_date::timestamp, v_now_local - interval '14 days')
    AND b.booked_at < (b.st AT TIME ZONE v_tz) - interval '10 minutes';
  IF v_m > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'meeting_reminders_sent', 'group', 'Notifications', 'label', 'Meeting reminders delivered',
      'status', CASE WHEN v_k = v_m THEN 'ok' ELSE 'warn' END,
      'detail', v_k || ' of ' || v_m || ' meetings that already started got their "starting soon" reminder.'
        || CASE WHEN v_k < v_m THEN ' Missed reminders can happen while notifications are paused.' ELSE '' END,
      'items', CASE WHEN jsonb_array_length(v_items) > 10 THEN (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(v_items) x LIMIT 10) q) ELSE v_items END);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.session_reminder_sent r WHERE r.session_id = s.id))
    INTO v_m, v_k
  FROM public.schedule_sessions s
  WHERE s.event_id = p_event_id AND s.is_active IS NOT FALSE
    AND (s.start_time AT TIME ZONE 'UTC') <= v_now_local - interval '10 minutes'
    AND (s.start_time AT TIME ZONE 'UTC') >= GREATEST(e.start_date::timestamp, v_now_local - interval '14 days')
    AND s.created_at < ((s.start_time AT TIME ZONE 'UTC') AT TIME ZONE v_tz) - interval '10 minutes';
  IF v_m > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'session_reminders_sent', 'group', 'Notifications', 'label', 'Session reminders delivered',
      'status', CASE WHEN v_k = v_m THEN 'ok' ELSE 'warn' END,
      'detail', v_k || ' of ' || v_m || ' sessions that already started had their "starting soon" reminder sent.'
        || CASE WHEN v_k < v_m THEN ' Missed reminders can happen while notifications are paused.' ELSE '' END);
  END IF;

  v_n := 0;
  v_items := '[]'::jsonb;
  FOR v_job IN
    SELECT j.jobname, j.active,
           (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run,
           (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '12 hours' AND d.status = 'failed') AS failed
    FROM cron.job j
    WHERE j.jobname IN ('notify-b2b-meeting-soon', 'notify-event-starting-soon')
  LOOP
    IF NOT v_job.active OR v_job.last_run IS NULL OR v_job.last_run < now() - interval '10 minutes' OR v_job.failed > 0 THEN
      v_n := v_n + 1;
      v_items := v_items || to_jsonb(
        CASE v_job.jobname WHEN 'notify-b2b-meeting-soon' THEN 'Meeting reminders' ELSE 'Session reminders' END || ': '
        || CASE WHEN NOT v_job.active THEN 'turned off'
                WHEN v_job.last_run IS NULL OR v_job.last_run < now() - interval '10 minutes' THEN 'not running'
                ELSE v_job.failed || ' failed runs in the last 12 hours' END);
    END IF;
  END LOOP;
  v_checks := v_checks || jsonb_build_object(
    'id', 'reminder_jobs', 'group', 'Notifications', 'label', 'Reminder system running',
    'status', CASE WHEN v_n = 0 THEN 'ok' ELSE 'fail' END,
    'detail', CASE WHEN v_n = 0 THEN 'Meeting and session reminders are checked every 2 minutes with no failures.'
                   ELSE 'The reminder system needs attention. Contact KBM support.' END,
    'items', v_items);

  SELECT count(*) FILTER (WHERE a.scheduled_at < now() - interval '10 minutes'),
         count(*) FILTER (WHERE a.scheduled_at >= now() - interval '10 minutes'),
         COALESCE(jsonb_agg(a.title || ' — ' || to_char(a.scheduled_at AT TIME ZONE v_tz, 'Dy Mon DD HH12:MI AM')
           || CASE WHEN a.scheduled_at < now() - interval '10 minutes' THEN ' (overdue)' ELSE '' END ORDER BY a.scheduled_at), '[]'::jsonb)
    INTO v_m, v_k, v_items
  FROM public.announcements a
  WHERE a.event_id = p_event_id AND a.scheduled_at IS NOT NULL AND a.sent_at IS NULL;
  IF v_m + v_k > 0 THEN
    v_checks := v_checks || jsonb_build_object(
      'id', 'scheduled_announcements', 'group', 'Notifications', 'label', 'Scheduled announcements',
      'status', CASE WHEN v_m > 0 THEN 'fail' ELSE 'info' END,
      'detail', CASE WHEN v_m > 0 THEN v_m || ' scheduled announcement' || CASE WHEN v_m = 1 THEN ' is' ELSE 's are' END || ' overdue and not sent.'
                     ELSE v_k || ' announcement' || CASE WHEN v_k = 1 THEN ' is' ELSE 's are' END || ' scheduled to send (venue time).' END,
      'items', v_items);
  END IF;

  -- Overall ----------------------------------------------------------------
  SELECT CASE WHEN bool_or(c->>'status' = 'fail') THEN 'fail'
              WHEN bool_or(c->>'status' = 'warn') THEN 'warn'
              ELSE 'ok' END
    INTO v_overall
  FROM jsonb_array_elements(v_checks) c;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'name', e.name, 'start_date', e.start_date, 'end_date', e.end_date,
      'timezone', v_tz, 'timezone_set', v_tz_set, 'phase', v_phase, 'phase_label', v_phase_label,
      'now_local', to_char(v_now_local, 'Dy Mon DD, HH12:MI AM')
    ),
    'overall', v_overall,
    'counts', (
      SELECT jsonb_build_object(
        'ok', count(*) FILTER (WHERE c->>'status' = 'ok'),
        'warn', count(*) FILTER (WHERE c->>'status' = 'warn'),
        'fail', count(*) FILTER (WHERE c->>'status' = 'fail'),
        'info', count(*) FILTER (WHERE c->>'status' = 'info'))
      FROM jsonb_array_elements(v_checks) c
    ),
    'checks', v_checks,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_readiness(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Platform health snapshot (platform admins)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jobs jsonb;
  v_events jsonb;
  v_net_total int;
  v_net_failed int;
  v_conns int;
  v_max_conns int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', j.jobname,
           'schedule', j.schedule,
           'active', j.active,
           'last_run', st.last_run,
           'last_status', st.last_status,
           'runs_24h', st.runs_24h,
           'failed_24h', st.failed_24h,
           'last_error', st.last_error
         ) ORDER BY j.jobname), '[]'::jsonb)
    INTO v_jobs
  FROM cron.job j
  CROSS JOIN LATERAL (
    SELECT
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run,
      (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status,
      (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours') AS runs_24h,
      (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '24 hours' AND d.status = 'failed') AS failed_24h,
      (SELECT left(d.return_message, 200) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed' AND d.start_time > now() - interval '24 hours' ORDER BY d.start_time DESC LIMIT 1) AS last_error
  ) st;

  SELECT count(*), count(*) FILTER (WHERE r.status_code >= 400 OR r.timed_out OR r.error_msg IS NOT NULL)
    INTO v_net_total, v_net_failed
  FROM net._http_response r
  WHERE r.created > now() - interval '24 hours';

  SELECT count(*) INTO v_conns FROM pg_stat_activity;
  SELECT setting::int INTO v_max_conns FROM pg_settings WHERE name = 'max_connections';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'name', ev.name,
           'start_date', ev.start_date,
           'end_date', ev.end_date,
           'overall', rd.r->'overall',
           'counts', rd.r->'counts',
           'phase_label', rd.r->'event'->'phase_label'
         ) ORDER BY ev.start_date), '[]'::jsonb)
    INTO v_events
  FROM public.events ev
  CROSS JOIN LATERAL public.admin_event_readiness(ev.id) AS rd(r)
  WHERE ev.is_active IS NOT FALSE
    AND ev.end_date >= current_date - 1
    AND ev.start_date <= current_date + 45;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'jobs', v_jobs,
    'server_calls', jsonb_build_object('total_24h', v_net_total, 'failed_24h', v_net_failed),
    'database', jsonb_build_object(
      'size', pg_size_pretty(pg_database_size(current_database())),
      'connections', v_conns,
      'max_connections', v_max_conns
    ),
    'activity', jsonb_build_object(
      'notifications_24h', (SELECT count(*) FROM public.notifications n WHERE n.created_at > now() - interval '24 hours'),
      'posts_24h', (SELECT count(*) FROM public.posts p WHERE p.created_at > now() - interval '24 hours'),
      'sign_ins_24h', (SELECT count(*) FROM public.users u WHERE u.last_login_at > now() - interval '24 hours')
    ),
    'events', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_health_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_health_snapshot() TO authenticated;
