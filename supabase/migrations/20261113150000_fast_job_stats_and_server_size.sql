-- Fast background-job stats: cron.job_run_details has ~775k rows and no jobid/start_time index, so scan only the
-- most recent runs (runid is the indexed primary key and increases with start time; 20000 runs ≈ 5 days).
-- Used by the readiness check and App health, which timed out scanning the whole table.

CREATE OR REPLACE FUNCTION public.recent_cron_job_stats()
RETURNS TABLE (
  jobname text, schedule text, active boolean, last_run timestamptz, last_status text,
  runs_24h bigint, failed_24h bigint, failed_12h bigint, last_error text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH recent AS (
    SELECT d.jobid, d.status, d.start_time, d.return_message, d.runid
    FROM cron.job_run_details d
    WHERE d.runid > (SELECT COALESCE(max(runid), 0) FROM cron.job_run_details) - 20000
  ), agg AS (
    SELECT r.jobid,
           max(r.start_time) AS last_run,
           count(*) FILTER (WHERE r.start_time > now() - interval '24 hours') AS runs_24h,
           count(*) FILTER (WHERE r.start_time > now() - interval '24 hours' AND r.status = 'failed') AS failed_24h,
           count(*) FILTER (WHERE r.start_time > now() - interval '12 hours' AND r.status = 'failed') AS failed_12h
    FROM recent r
    GROUP BY r.jobid
  ), last_run AS (
    SELECT DISTINCT ON (r.jobid) r.jobid, r.status
    FROM recent r
    ORDER BY r.jobid, r.runid DESC
  ), last_err AS (
    SELECT DISTINCT ON (r.jobid) r.jobid, left(r.return_message, 200) AS msg
    FROM recent r
    WHERE r.status = 'failed' AND r.start_time > now() - interval '24 hours'
    ORDER BY r.jobid, r.runid DESC
  )
  SELECT j.jobname::text, j.schedule::text, j.active, a.last_run, l.status::text,
         COALESCE(a.runs_24h, 0), COALESCE(a.failed_24h, 0), COALESCE(a.failed_12h, 0), e.msg
  FROM cron.job j
  LEFT JOIN agg a ON a.jobid = j.jobid
  LEFT JOIN last_run l ON l.jobid = j.jobid
  LEFT JOIN last_err e ON e.jobid = j.jobid;
$$;

REVOKE ALL ON FUNCTION public.recent_cron_job_stats() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_event_readiness_core(p_event_id uuid)
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
    SELECT s.jobname, s.active, s.last_run, s.failed_12h AS failed
    FROM public.recent_cron_job_stats() s
    WHERE s.jobname IN ('notify-b2b-meeting-soon', 'notify-event-starting-soon')
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


REVOKE ALL ON FUNCTION public.admin_event_readiness_core(uuid) FROM PUBLIC, anon, authenticated;

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
  v_active_conns int;
  v_max_conns int;
  v_peak_meetings jsonb;
  v_peak_sessions jsonb;
  v_peak_attendees jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', s.jobname,
           'schedule', s.schedule,
           'active', s.active,
           'last_run', s.last_run,
           'last_status', s.last_status,
           'runs_24h', s.runs_24h,
           'failed_24h', s.failed_24h,
           'last_error', s.last_error
         ) ORDER BY s.jobname), '[]'::jsonb)
    INTO v_jobs
  FROM public.recent_cron_job_stats() s;

  SELECT count(*), count(*) FILTER (WHERE r.status_code >= 400 OR r.timed_out OR r.error_msg IS NOT NULL)
    INTO v_net_total, v_net_failed
  FROM net._http_response r
  WHERE r.created > now() - interval '24 hours';

  SELECT count(*), count(*) FILTER (WHERE a.state = 'active' AND a.pid <> pg_backend_pid())
    INTO v_conns, v_active_conns
  FROM pg_stat_activity a;
  SELECT setting::int INTO v_max_conns FROM pg_settings WHERE name = 'max_connections';

  -- Busiest upcoming start time in the next 7 days (venue wall clock, interpreted in each event's zone).
  WITH ev AS (
    SELECT e.id, e.name,
           CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = NULLIF(trim(COALESCE(e.reminder_timezone, '')), ''))
                THEN trim(e.reminder_timezone) ELSE 'America/New_York' END AS tz
    FROM public.events e
    WHERE e.is_active IS NOT FALSE
      AND e.end_date >= current_date - 1
      AND e.start_date <= current_date + 7
  ), reps AS (
    SELECT booth_id, count(DISTINCT uid) AS cnt FROM (
      SELECT r.booth_id, r.user_id AS uid FROM public.vendor_booth_reps r
      UNION SELECT vb.id, vb.contact_user_id FROM public.vendor_booths vb WHERE vb.contact_user_id IS NOT NULL
    ) x GROUP BY booth_id
  ), m AS (
    SELECT ev.name, ms.start_time, count(*) AS meetings, sum(1 + COALESCE(reps.cnt, 0)) AS pushes
    FROM ev
    JOIN public.vendor_booths vb ON vb.event_id = ev.id
    JOIN public.meeting_slots ms ON ms.booth_id = vb.id
    JOIN public.meeting_bookings mb ON mb.slot_id = ms.id AND mb.status <> 'cancelled'
    LEFT JOIN reps ON reps.booth_id = vb.id
    WHERE (ms.start_time AT TIME ZONE 'UTC') > (now() AT TIME ZONE ev.tz)
      AND (ms.start_time AT TIME ZONE 'UTC') <= (now() AT TIME ZONE ev.tz) + interval '7 days'
    GROUP BY ev.name, ms.start_time
  )
  SELECT jsonb_build_object('event', name, 'when', to_char(start_time AT TIME ZONE 'UTC', 'Dy Mon DD, HH12:MI AM'),
                            'meetings', meetings, 'pushes', pushes)
    INTO v_peak_meetings
  FROM m ORDER BY pushes DESC, start_time LIMIT 1;

  WITH ev AS (
    SELECT e.id, e.name,
           CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = NULLIF(trim(COALESCE(e.reminder_timezone, '')), ''))
                THEN trim(e.reminder_timezone) ELSE 'America/New_York' END AS tz,
           (SELECT count(*) FROM public.event_members em JOIN public.users u ON u.id = em.user_id
             WHERE em.event_id = e.id AND COALESCE(em.is_active, true) AND NOT em.is_hidden
               AND NULLIF(trim(COALESCE(u.push_token, '')), '') IS NOT NULL) AS push_members
    FROM public.events e
    WHERE e.is_active IS NOT FALSE
      AND e.end_date >= current_date - 1
      AND e.start_date <= current_date + 7
  ), s AS (
    SELECT ev.name, ss.start_time, count(*) AS sessions, count(*) * max(ev.push_members) AS pushes
    FROM ev
    JOIN public.schedule_sessions ss ON ss.event_id = ev.id AND ss.is_active IS NOT FALSE
    WHERE (ss.start_time AT TIME ZONE 'UTC') > (now() AT TIME ZONE ev.tz)
      AND (ss.start_time AT TIME ZONE 'UTC') <= (now() AT TIME ZONE ev.tz) + interval '7 days'
    GROUP BY ev.name, ss.start_time
  )
  SELECT jsonb_build_object('event', name, 'when', to_char(start_time AT TIME ZONE 'UTC', 'Dy Mon DD, HH12:MI AM'),
                            'sessions', sessions, 'pushes', pushes)
    INTO v_peak_sessions
  FROM s ORDER BY pushes DESC, start_time LIMIT 1;

  -- Most attendees whose events run on the same day in the next 7 days (drives the server size suggestion).
  WITH days AS (
    SELECT generate_series(current_date, current_date + 7, interval '1 day')::date AS d
  ), ev AS (
    SELECT e.name, e.start_date, e.end_date,
           (SELECT count(*) FROM public.event_members em
             WHERE em.event_id = e.id AND COALESCE(em.is_active, true) AND NOT em.is_hidden) AS members
    FROM public.events e
    WHERE e.is_active IS NOT FALSE
      AND e.end_date >= current_date
      AND e.start_date <= current_date + 7
  )
  SELECT jsonb_build_object('date', to_char(days.d, 'Dy Mon DD'), 'members', sum(ev.members), 'events', jsonb_agg(ev.name))
    INTO v_peak_attendees
  FROM days
  JOIN ev ON days.d BETWEEN ev.start_date AND ev.end_date
  GROUP BY days.d
  ORDER BY sum(ev.members) DESC, days.d
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id,
           'name', ev.name,
           'start_date', ev.start_date,
           'end_date', ev.end_date,
           'overall', rd.r->'overall',
           'counts', rd.r->'counts',
           'phase_label', rd.r->'event'->'phase_label',
           'issues', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'status', c->'status', 'label', c->'label', 'detail', c->'detail', 'items', c->'items')
                    ORDER BY CASE c->>'status' WHEN 'fail' THEN 0 ELSE 1 END), '[]'::jsonb)
             FROM jsonb_array_elements(rd.r->'checks') c
             WHERE c->>'status' IN ('fail', 'warn')
           )
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
      'active_connections', v_active_conns,
      'max_connections', v_max_conns
    ),
    'load', jsonb_build_object(
      'peak_meetings', v_peak_meetings,
      'peak_sessions', v_peak_sessions,
      'peak_attendees', v_peak_attendees
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
