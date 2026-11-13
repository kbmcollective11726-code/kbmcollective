-- App health busiest moment: combine events whose meetings or sessions start at the same real moment,
-- including events in different time zones.

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
    -- Same real moment across events (and time zones) counts together.
    SELECT (ms.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz AS at_instant,
           ev.name, ev.tz, count(*) AS meetings, sum(1 + COALESCE(reps.cnt, 0)) AS pushes
    FROM ev
    JOIN public.vendor_booths vb ON vb.event_id = ev.id
    JOIN public.meeting_slots ms ON ms.booth_id = vb.id
    JOIN public.meeting_bookings mb ON mb.slot_id = ms.id AND mb.status <> 'cancelled'
    LEFT JOIN reps ON reps.booth_id = vb.id
    WHERE (ms.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz > now()
      AND (ms.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz <= now() + interval '7 days'
    GROUP BY 1, ev.name, ev.tz
  ), mt AS (
    SELECT at_instant, string_agg(name, ' + ' ORDER BY name) AS events, min(tz) AS tz,
           sum(meetings) AS meetings, sum(pushes) AS pushes
    FROM m GROUP BY at_instant
  )
  SELECT jsonb_build_object('event', events, 'when', to_char(at_instant AT TIME ZONE tz, 'Dy Mon DD, HH12:MI AM'),
                            'timezone', tz, 'meetings', meetings, 'pushes', pushes)
    INTO v_peak_meetings
  FROM mt ORDER BY pushes DESC, at_instant LIMIT 1;

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
    SELECT (ss.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz AS at_instant,
           ev.name, ev.tz, count(*) AS sessions, count(*) * max(ev.push_members) AS pushes
    FROM ev
    JOIN public.schedule_sessions ss ON ss.event_id = ev.id AND ss.is_active IS NOT FALSE
    WHERE (ss.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz > now()
      AND (ss.start_time AT TIME ZONE 'UTC') AT TIME ZONE ev.tz <= now() + interval '7 days'
    GROUP BY 1, ev.name, ev.tz
  ), st AS (
    SELECT at_instant, string_agg(name, ' + ' ORDER BY name) AS events, min(tz) AS tz,
           sum(sessions) AS sessions, sum(pushes) AS pushes
    FROM s GROUP BY at_instant
  )
  SELECT jsonb_build_object('event', events, 'when', to_char(at_instant AT TIME ZONE tz, 'Dy Mon DD, HH12:MI AM'),
                            'timezone', tz, 'sessions', sessions, 'pushes', pushes)
    INTO v_peak_sessions
  FROM st ORDER BY pushes DESC, at_instant LIMIT 1;

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
