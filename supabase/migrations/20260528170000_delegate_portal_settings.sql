-- Delegate portal: hotel tab toggle, team notify emails, submission access by email, admin email on submit.

ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS delegate_portal_hotel_visible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delegate_hotel_content TEXT,
  ADD COLUMN IF NOT EXISTS registration_notify_team_emails TEXT;

COMMENT ON COLUMN public.event_matchmaking_settings.delegate_portal_hotel_visible IS
  'When false, delegates do not see the Hotel tab in the registration portal.';
COMMENT ON COLUMN public.event_matchmaking_settings.delegate_hotel_content IS
  'Rich text / HTML shown on the delegate portal Hotel tab.';
COMMENT ON COLUMN public.event_matchmaking_settings.registration_notify_team_emails IS
  'Comma-separated emails notified when a delegate submits registration (in addition to event admins).';

-- Match submission rows to logged-in delegate by auth user id or profile email.
CREATE OR REPLACE FUNCTION public.registration_submission_owned_by_auth(p_submission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    LEFT JOIN public.users u ON u.id = auth.uid()
    WHERE s.id = p_submission_id
      AND (
        s.user_id = auth.uid()
        OR (
          s.user_id IS NULL
          AND s.email IS NOT NULL
          AND u.email IS NOT NULL
          AND lower(trim(s.email)) = lower(trim(u.email))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.registration_submission_owned_by_auth(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_submission_owned_by_auth(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_submitted_delegate_registration(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    LEFT JOIN public.users u ON u.id = auth.uid()
    WHERE s.event_id = p_event_id
      AND s.attendee_type = 'attendee'
      AND s.status = 'submitted'
      AND (
        s.user_id = auth.uid()
        OR (
          s.email IS NOT NULL
          AND u.email IS NOT NULL
          AND lower(trim(s.email)) = lower(trim(u.email))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_submitted_delegate_registration(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_submitted_delegate_registration(UUID) TO authenticated, service_role;

-- Link orphan portal submissions to auth user after login.
CREATE OR REPLACE FUNCTION public.link_my_delegate_submission(p_event_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_submission_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.email INTO v_email FROM public.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RETURN NULL;
  END IF;

  UPDATE public.event_registration_submissions s
  SET user_id = auth.uid(), updated_at = now()
  WHERE s.event_id = p_event_id
    AND s.attendee_type = 'attendee'
    AND s.status = 'submitted'
    AND s.user_id IS NULL
    AND lower(trim(s.email)) = lower(trim(v_email))
  RETURNING s.id INTO v_submission_id;

  IF v_submission_id IS NOT NULL THEN
    RETURN v_submission_id;
  END IF;

  SELECT s.id INTO v_submission_id
  FROM public.event_registration_submissions s
  WHERE s.event_id = p_event_id
    AND s.attendee_type = 'attendee'
    AND s.status = 'submitted'
    AND s.user_id = auth.uid()
  ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;

  RETURN v_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_my_delegate_submission(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_my_delegate_submission(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_event_meeting_requests_open(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.meeting_requests_open
      FROM public.event_matchmaking_settings s
      WHERE s.event_id = p_event_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_event_meeting_requests_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_meeting_requests_open(UUID) TO anon, authenticated, service_role;

-- Settings readable when registration open OR delegate has a submission OR admin.
DROP POLICY IF EXISTS "Public read open matchmaking settings" ON public.event_matchmaking_settings;
CREATE POLICY "Public read open matchmaking settings" ON public.event_matchmaking_settings
  FOR SELECT
  USING (
    registration_open = true
    OR public.is_event_admin(event_id)
    OR public.is_platform_admin(auth.uid())
    OR public.has_submitted_delegate_registration(event_id)
  );

-- Submission access by email match for delegates.
DROP POLICY IF EXISTS "Members read submissions in their events" ON public.event_registration_submissions;
CREATE POLICY "Members read submissions in their events" ON public.event_registration_submissions
  FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
    OR public.registration_submission_owned_by_auth(id)
  );

DROP POLICY IF EXISTS "Members update own submissions" ON public.event_registration_submissions;
CREATE POLICY "Members update own submissions" ON public.event_registration_submissions
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
    OR public.registration_submission_owned_by_auth(id)
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
    OR public.registration_submission_owned_by_auth(id)
  );

DROP POLICY IF EXISTS "Members read answers in own submissions" ON public.event_registration_answers;
CREATE POLICY "Members read answers in own submissions" ON public.event_registration_answers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_registration_answers.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
    )
  );

DROP POLICY IF EXISTS "Members manage answers in own submissions" ON public.event_registration_answers;
CREATE POLICY "Members manage answers in own submissions" ON public.event_registration_answers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_registration_answers.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_registration_answers.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
    )
  );

DROP POLICY IF EXISTS "Members read meeting interest requests in own submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Members read meeting interest requests in own submissions" ON public.event_meeting_interest_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_meeting_interest_requests.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
    )
  );

DROP POLICY IF EXISTS "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests
  FOR ALL
  USING (
    (
      public.is_platform_admin(auth.uid())
      OR public.is_event_admin(event_id)
    )
    OR (
      public.is_event_meeting_requests_open(event_id)
      AND EXISTS (
        SELECT 1
        FROM public.event_registration_submissions s
        WHERE s.id = event_meeting_interest_requests.submission_id
        AND (
          s.user_id = auth.uid()
          OR public.registration_submission_owned_by_auth(s.id)
        )
      )
    )
  )
  WITH CHECK (
    (
      public.is_platform_admin(auth.uid())
      OR public.is_event_admin(event_id)
    )
    OR (
      public.is_event_meeting_requests_open(event_id)
      AND EXISTS (
        SELECT 1
        FROM public.event_registration_submissions s
        WHERE s.id = event_meeting_interest_requests.submission_id
        AND (
          s.user_id = auth.uid()
          OR public.registration_submission_owned_by_auth(s.id)
        )
      )
    )
  );

-- Queue email to event admins + team when a registration is submitted.
CREATE OR REPLACE FUNCTION public.queue_registration_submitted_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_anon TEXT;
  v_secret TEXT;
BEGIN
  IF NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL;
  END;

  IF v_url IS NULL OR v_anon IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-registration-submitted-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'submission_id', NEW.id,
      'event_id', NEW.event_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_submitted_email ON public.event_registration_submissions;
CREATE TRIGGER trg_registration_submitted_email
  AFTER INSERT OR UPDATE OF status ON public.event_registration_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_registration_submitted_email();
