-- KBM-style registration foundation:
-- per-event forms, questions, submissions, answers, and manual meeting interests.

CREATE TABLE IF NOT EXISTS public.event_matchmaking_settings (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  registration_open BOOLEAN NOT NULL DEFAULT false,
  meeting_requests_open BOOLEAN NOT NULL DEFAULT false,
  max_meetings_per_attendee INT NOT NULL DEFAULT 8 CHECK (max_meetings_per_attendee >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_registration_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('attendee', 'vendor', 'user')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_registration_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.event_registration_forms(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  field_key TEXT,
  help_text TEXT,
  placeholder TEXT,
  question_type TEXT NOT NULL CHECK (question_type IN ('text', 'textarea', 'single_select', 'multi_select', 'boolean', 'number', 'email')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_registration_question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.event_registration_questions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_registration_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  form_id UUID NOT NULL REFERENCES public.event_registration_forms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attendee_type TEXT NOT NULL CHECK (attendee_type IN ('attendee', 'vendor', 'user')),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  company_name TEXT,
  job_title TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_registration_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.event_registration_questions(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_number NUMERIC,
  answer_boolean BOOLEAN,
  answer_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_answers_one_per_question UNIQUE (submission_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.event_meeting_interest_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  target_company_name TEXT,
  target_person_name TEXT,
  reason TEXT,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_registration_forms_event ON public.event_registration_forms(event_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_registration_questions_form ON public.event_registration_questions(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_registration_question_options_question ON public.event_registration_question_options(question_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_registration_submissions_event ON public.event_registration_submissions(event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_registration_submissions_form ON public.event_registration_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_submissions_user ON public.event_registration_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_event_registration_answers_submission ON public.event_registration_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_event_meeting_interest_requests_event ON public.event_meeting_interest_requests(event_id, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_meeting_interest_requests_submission ON public.event_meeting_interest_requests(submission_id);

ALTER TABLE public.event_matchmaking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_meeting_interest_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event admins manage matchmaking settings" ON public.event_matchmaking_settings;
CREATE POLICY "Event admins manage matchmaking settings" ON public.event_matchmaking_settings
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Event members can view registration forms" ON public.event_registration_forms;
CREATE POLICY "Event members can view registration forms" ON public.event_registration_forms
  FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = event_registration_forms.event_id AND em.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Event admins manage registration forms" ON public.event_registration_forms;
CREATE POLICY "Event admins manage registration forms" ON public.event_registration_forms
  FOR ALL
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Event members can view registration questions" ON public.event_registration_questions;
CREATE POLICY "Event members can view registration questions" ON public.event_registration_questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_forms f
      WHERE f.id = event_registration_questions.form_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(f.event_id)
        OR EXISTS (
          SELECT 1 FROM public.event_members em
          WHERE em.event_id = f.event_id AND em.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Event admins manage registration questions" ON public.event_registration_questions;
CREATE POLICY "Event admins manage registration questions" ON public.event_registration_questions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_forms f
      WHERE f.id = event_registration_questions.form_id
      AND (public.is_event_admin(f.event_id) OR public.is_platform_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_forms f
      WHERE f.id = event_registration_questions.form_id
      AND (public.is_event_admin(f.event_id) OR public.is_platform_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Event members can view question options" ON public.event_registration_question_options;
CREATE POLICY "Event members can view question options" ON public.event_registration_question_options
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_questions q
      JOIN public.event_registration_forms f ON f.id = q.form_id
      WHERE q.id = event_registration_question_options.question_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(f.event_id)
        OR EXISTS (
          SELECT 1 FROM public.event_members em
          WHERE em.event_id = f.event_id AND em.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Event admins manage question options" ON public.event_registration_question_options;
CREATE POLICY "Event admins manage question options" ON public.event_registration_question_options
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_questions q
      JOIN public.event_registration_forms f ON f.id = q.form_id
      WHERE q.id = event_registration_question_options.question_id
      AND (public.is_event_admin(f.event_id) OR public.is_platform_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_questions q
      JOIN public.event_registration_forms f ON f.id = q.form_id
      WHERE q.id = event_registration_question_options.question_id
      AND (public.is_event_admin(f.event_id) OR public.is_platform_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Members read submissions in their events" ON public.event_registration_submissions;
CREATE POLICY "Members read submissions in their events" ON public.event_registration_submissions
  FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Members can create own submissions" ON public.event_registration_submissions;
CREATE POLICY "Members can create own submissions" ON public.event_registration_submissions
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Members update own submissions" ON public.event_registration_submissions;
CREATE POLICY "Members update own submissions" ON public.event_registration_submissions
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Event admins delete submissions" ON public.event_registration_submissions;
CREATE POLICY "Event admins delete submissions" ON public.event_registration_submissions
  FOR DELETE
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

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
      )
    )
  );

DROP POLICY IF EXISTS "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_meeting_interest_requests.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions s
      WHERE s.id = event_meeting_interest_requests.submission_id
      AND (
        public.is_platform_admin(auth.uid())
        OR public.is_event_admin(s.event_id)
        OR s.user_id = auth.uid()
      )
    )
  );
