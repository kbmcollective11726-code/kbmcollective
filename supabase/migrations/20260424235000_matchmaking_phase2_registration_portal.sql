-- Phase 2: richer form builder + public registration portal support.

ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS section_label TEXT;

-- Public can read active registration forms/questions/options when registration is open.
DROP POLICY IF EXISTS "Public read open registration forms" ON public.event_registration_forms;
CREATE POLICY "Public read open registration forms" ON public.event_registration_forms
  FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.event_matchmaking_settings s
      WHERE s.event_id = event_registration_forms.event_id
        AND s.registration_open = true
    )
  );

DROP POLICY IF EXISTS "Public read open registration questions" ON public.event_registration_questions;
CREATE POLICY "Public read open registration questions" ON public.event_registration_questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_forms f
      JOIN public.event_matchmaking_settings s ON s.event_id = f.event_id
      WHERE f.id = event_registration_questions.form_id
        AND f.is_active = true
        AND s.registration_open = true
    )
  );

DROP POLICY IF EXISTS "Public read open registration options" ON public.event_registration_question_options;
CREATE POLICY "Public read open registration options" ON public.event_registration_question_options
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_questions q
      JOIN public.event_registration_forms f ON f.id = q.form_id
      JOIN public.event_matchmaking_settings s ON s.event_id = f.event_id
      WHERE q.id = event_registration_question_options.question_id
        AND f.is_active = true
        AND s.registration_open = true
    )
  );

-- Public can create submissions/answers/meeting requests for open registration events.
DROP POLICY IF EXISTS "Public insert submissions when registration open" ON public.event_registration_submissions;
CREATE POLICY "Public insert submissions when registration open" ON public.event_registration_submissions
  FOR INSERT
  WITH CHECK (
    user_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.event_matchmaking_settings s
      WHERE s.event_id = event_registration_submissions.event_id
        AND s.registration_open = true
    )
  );

DROP POLICY IF EXISTS "Public insert answers for open registration submissions" ON public.event_registration_answers;
CREATE POLICY "Public insert answers for open registration submissions" ON public.event_registration_answers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions sub
      JOIN public.event_matchmaking_settings s ON s.event_id = sub.event_id
      WHERE sub.id = event_registration_answers.submission_id
        AND sub.user_id IS NULL
        AND s.registration_open = true
    )
  );

DROP POLICY IF EXISTS "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Public insert meeting interests for open registration submissions" ON public.event_meeting_interest_requests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_registration_submissions sub
      JOIN public.event_matchmaking_settings s ON s.event_id = sub.event_id
      WHERE sub.id = event_meeting_interest_requests.submission_id
        AND sub.user_id IS NULL
        AND s.registration_open = true
    )
  );
