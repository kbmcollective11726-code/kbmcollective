-- User reports: optional event_id for routing + in-app notifications to event admins and platform admins.

ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_reports_event_id ON public.user_reports(event_id);

-- Require reporter to belong to event when event_id is set (integrity + abuse resistance).
DROP POLICY IF EXISTS "Users can insert own reports" ON public.user_reports;
CREATE POLICY "Users can insert own reports" ON public.user_reports
  FOR INSERT
  WITH CHECK (
    auth.uid() = reporter_id
    AND (
      event_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.event_members em
        WHERE em.event_id = user_reports.event_id
          AND em.user_id = auth.uid()
      )
    )
  );

-- Allow notification type user_report
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting',
      'schedule_change', 'connection_request', 'system', 'user_report'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.notify_admins_on_user_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_ids uuid[];
  uid uuid;
  title_text text;
  body_text text;
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT q.user_id), ARRAY[]::uuid[])
  INTO admin_ids
  FROM (
    SELECT em.user_id
    FROM public.event_members em
    WHERE em.event_id = NEW.event_id
      AND (
        em.role IN ('admin', 'super_admin')
        OR (em.roles IS NOT NULL AND em.roles && ARRAY['admin', 'super_admin']::text[])
      )
    UNION
    SELECT u.id AS user_id
    FROM public.users u
    WHERE COALESCE(u.is_platform_admin, false) = true
  ) q;

  IF admin_ids IS NULL OR cardinality(admin_ids) = 0 THEN
    RETURN NEW;
  END IF;

  admin_ids := array_remove(admin_ids, NEW.reporter_id);
  IF admin_ids IS NULL OR cardinality(admin_ids) = 0 THEN
    RETURN NEW;
  END IF;

  title_text := 'User report';
  body_text := format('A member submitted a report (%s). Review in Event safety.', NEW.reason);

  FOREACH uid IN ARRAY admin_ids
  LOOP
    INSERT INTO public.notifications (user_id, event_id, type, title, body, data)
    VALUES (
      uid,
      NEW.event_id,
      'user_report',
      title_text,
      body_text,
      jsonb_build_object(
        'report_id', NEW.id,
        'reported_user_id', NEW.reported_user_id,
        'reporter_id', NEW.reporter_id
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_report_notify_admins ON public.user_reports;
CREATE TRIGGER trg_user_report_notify_admins
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_on_user_report();

-- Safety list: prefer explicit event_id; keep overlap filter for legacy rows without it.
CREATE OR REPLACE FUNCTION public.list_event_safety_records(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reports jsonb := '[]'::jsonb;
  v_blocks jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT jsonb_build_object(
      'id', ur.id,
      'reason', ur.reason,
      'details', ur.details,
      'created_at', ur.created_at,
      'event_id', ur.event_id,
      'reporter', jsonb_build_object(
        'user_id', ru.id,
        'full_name', coalesce(ru.full_name, ''),
        'email', coalesce(ru.email, '')
      ),
      'reported', jsonb_build_object(
        'user_id', uu.id,
        'full_name', coalesce(uu.full_name, ''),
        'email', coalesce(uu.email, '')
      )
    ) AS x,
    ur.created_at AS ord
    FROM public.user_reports ur
    INNER JOIN public.users ru ON ru.id = ur.reporter_id
    INNER JOIN public.users uu ON uu.id = ur.reported_user_id
    WHERE (
      ur.event_id IS NOT DISTINCT FROM p_event_id
      OR (
        ur.event_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.event_members em1
          WHERE em1.event_id = p_event_id AND em1.user_id = ur.reporter_id
        )
        AND EXISTS (
          SELECT 1 FROM public.event_members em2
          WHERE em2.event_id = p_event_id AND em2.user_id = ur.reported_user_id
        )
      )
    )
  ) q;

  SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_blocks
  FROM (
    SELECT jsonb_build_object(
      'id', bu.id,
      'created_at', bu.created_at,
      'blocker', jsonb_build_object(
        'user_id', bku.id,
        'full_name', coalesce(bku.full_name, ''),
        'email', coalesce(bku.email, '')
      ),
      'blocked', jsonb_build_object(
        'user_id', ubd.id,
        'full_name', coalesce(ubd.full_name, ''),
        'email', coalesce(ubd.email, '')
      )
    ) AS x,
    bu.created_at AS ord
    FROM public.blocked_users bu
    INNER JOIN public.users bku ON bku.id = bu.blocker_id
    INNER JOIN public.users ubd ON ubd.id = bu.blocked_user_id
    WHERE EXISTS (
      SELECT 1 FROM public.event_members em1
      WHERE em1.event_id = p_event_id AND em1.user_id = bu.blocker_id
    )
    AND EXISTS (
      SELECT 1 FROM public.event_members em2
      WHERE em2.event_id = p_event_id AND em2.user_id = bu.blocked_user_id
    )
  ) q2;

  RETURN jsonb_build_object('reports', v_reports, 'blocks', v_blocks);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_safety_records(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_safety_records(uuid) TO authenticated;
