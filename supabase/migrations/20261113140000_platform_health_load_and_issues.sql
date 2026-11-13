-- App health: server size, active connections, busiest upcoming reminder moment, and each event's open issues.

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
      'peak_sessions', v_peak_sessions
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
