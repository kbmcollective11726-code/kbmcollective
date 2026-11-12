-- Per-question "show on profile" for Meeting Selections, independent of is_hidden (form visibility).
-- Contact fields are never published to other participants, whatever the setting.

ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS show_on_profile BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.event_registration_questions.show_on_profile IS
  'When false, the answer is collected and visible to event admins but not shown on participant profiles (Meeting Selections). Independent of is_hidden.';

CREATE OR REPLACE FUNCTION public.registration_prompt_is_contact(p_prompt TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(coalesce(p_prompt, ''))) ~ '(phone|e-?mail|password|zip|postal)'
    OR lower(trim(coalesce(p_prompt, ''))) IN ('address', 'street address', 'personal address', 'home address')
    OR lower(trim(coalesce(p_prompt, ''))) LIKE 'assistant %';
$$;

CREATE OR REPLACE FUNCTION public.registration_prompt_private_by_default(p_prompt TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.registration_prompt_is_contact(p_prompt)
    OR lower(trim(coalesce(p_prompt, ''))) IN (
      'dietary restrictions',
      'how did you hear about this event?',
      'username (create one to login in future)',
      'username'
    );
$$;

UPDATE public.event_registration_questions
SET show_on_profile = false
WHERE public.registration_prompt_private_by_default(prompt)
  AND show_on_profile = true;

CREATE OR REPLACE FUNCTION public.registration_question_default_profile_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.registration_prompt_private_by_default(NEW.prompt) THEN
    NEW.show_on_profile := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_question_default_profile_visibility
  ON public.event_registration_questions;
CREATE TRIGGER trg_registration_question_default_profile_visibility
  BEFORE INSERT ON public.event_registration_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.registration_question_default_profile_visibility();

-- Group employee count with revenue / budget on existing forms.
UPDATE public.event_registration_questions
SET section_label = 'Eligibility & buying intent'
WHERE lower(trim(prompt)) = 'total number of employees globally'
  AND coalesce(section_label, '') <> 'Eligibility & buying intent';

CREATE OR REPLACE FUNCTION public.get_meeting_request_target_profile(
  p_event_id uuid,
  p_submission_id uuid,
  p_target_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.event_registration_submissions;
  v_target public.event_registration_submissions;
  v_answers jsonb;
  v_categories jsonb;
BEGIN
  v_source := public.assert_meeting_request_caller(p_submission_id);
  IF v_source.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Source submission is not part of this event'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_target
  FROM public.event_registration_submissions s
  WHERE s.id = p_target_submission_id
    AND s.event_id = p_event_id
    AND s.status = 'submitted'
    AND s.registration_status = 'approved'
    AND s.profile_complete = true
    AND s.attendee_type = CASE
      WHEN v_source.attendee_type = 'vendor' THEN 'attendee'
      ELSE 'vendor'
    END
  LIMIT 1;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'Target profile not available'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'prompt', q.prompt,
    'section_label', q.section_label,
    'value', coalesce(
      CASE
        WHEN a.answer_json IS NOT NULL AND jsonb_typeof(a.answer_json) = 'array'
          THEN (SELECT string_agg(elem, ', ' ORDER BY ord)
                FROM jsonb_array_elements_text(a.answer_json)
                WITH ORDINALITY AS t(elem, ord))
        WHEN a.answer_json IS NOT NULL THEN a.answer_json #>> '{}'
        WHEN a.answer_boolean IS NOT NULL THEN CASE WHEN a.answer_boolean THEN 'Yes' ELSE 'No' END
        WHEN a.answer_number IS NOT NULL THEN a.answer_number::text
        ELSE a.answer_text
      END,
      ''
    )
  ) ORDER BY q.sort_order, q.created_at), '[]'::jsonb)
  INTO v_answers
  FROM public.event_registration_answers a
  JOIN public.event_registration_questions q ON q.id = a.question_id
  WHERE a.submission_id = v_target.id
    AND q.show_on_profile = true
    AND q.is_hidden = false
    AND NOT public.registration_prompt_is_contact(q.prompt)
    AND lower(trim(q.prompt)) NOT IN (
      'first name', 'last name', 'company name', 'job title'
    );

  SELECT coalesce(
    jsonb_agg(c.category_name ORDER BY c.display_order, c.category_name),
    '[]'::jsonb
  )
  INTO v_categories
  FROM public.event_registration_solution_categories sc
  JOIN public.event_solution_categories c ON c.id = sc.category_id
  WHERE sc.submission_id = v_target.id;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'first_name', v_target.first_name,
    'last_name', v_target.last_name,
    'company_name', v_target.company_name,
    'job_title', v_target.job_title,
    'attendee_type', v_target.attendee_type,
    'answers', v_answers,
    'categories', v_categories
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_meeting_request_target_profile(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_request_target_profile(uuid, uuid, uuid)
  TO authenticated, service_role;

-- App: phone and email only for yourself, platform admins, and admins of an event the member is in.
CREATE OR REPLACE FUNCTION public.get_user_networking_contact(p_user_id uuid)
RETURNS TABLE(user_id uuid, email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u.phone
  FROM public.users u
  WHERE u.id = p_user_id
    AND auth.uid() IS NOT NULL
    AND public.is_account_active(auth.uid())
    AND (
      u.id = auth.uid()
      OR public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.event_members them
        WHERE them.user_id = p_user_id
          AND public.is_event_admin(them.event_id)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.get_visible_user_profile(p_user_id uuid)
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  title text,
  company text,
  linkedin_url text,
  bio text,
  is_active boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  is_platform_admin boolean,
  last_login_at timestamp with time zone,
  session_reminder_skip_same_room boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    CASE
      WHEN u.id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.event_members them
          WHERE them.user_id = u.id
            AND public.is_event_admin(them.event_id)
        )
      THEN u.email
      ELSE NULL
    END,
    u.full_name,
    u.avatar_url,
    u.title,
    u.company,
    u.linkedin_url,
    u.bio,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.is_platform_admin,
    u.last_login_at,
    u.session_reminder_skip_same_room
  FROM public.users u
  WHERE u.id = p_user_id
    AND auth.uid() IS NOT NULL
    AND public.is_account_active(auth.uid())
    AND (
      u.id = auth.uid()
      OR public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.event_members me
        JOIN public.event_members them ON them.event_id = me.event_id
        WHERE me.user_id = auth.uid()
          AND them.user_id = u.id
      )
    );
$$;
