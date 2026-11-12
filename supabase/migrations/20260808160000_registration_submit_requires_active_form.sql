-- Public/member registration inserts must target an active form for the same event.
-- Platform/event admins may still insert for inactive forms (ops / recovery).
--
-- IMPORTANT: qualify columns as event_registration_submissions.* inside EXISTS so
-- form_id / event_id are not shadowed by event_registration_forms aliases.

DROP POLICY IF EXISTS "event_registration_submissions_insert_perm" ON public.event_registration_submissions;

CREATE POLICY "event_registration_submissions_insert_perm" ON public.event_registration_submissions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    (
      is_platform_admin((SELECT auth.uid() AS uid))
      OR is_event_admin(event_registration_submissions.event_id)
    )
    OR (
      (
        event_registration_submissions.user_id = (SELECT auth.uid() AS uid)
        OR (
          event_registration_submissions.user_id IS NULL
          AND is_event_registration_open(event_registration_submissions.event_id)
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.event_registration_forms f
        WHERE f.id = event_registration_submissions.form_id
          AND f.event_id = event_registration_submissions.event_id
          AND f.is_active = true
      )
    )
  );
