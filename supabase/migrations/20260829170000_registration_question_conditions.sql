-- Allow a registration question to be shown only when another question has
-- a specific answer (for example, show a follow-up when the answer is Yes).
ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS condition_question_id UUID
    REFERENCES public.event_registration_questions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition_value TEXT;

CREATE INDEX IF NOT EXISTS event_registration_questions_condition_idx
  ON public.event_registration_questions(condition_question_id);

ALTER TABLE public.event_registration_questions
  DROP CONSTRAINT IF EXISTS event_registration_questions_condition_same_form;

ALTER TABLE public.event_registration_questions
  ADD CONSTRAINT event_registration_questions_condition_same_form
  CHECK (condition_question_id IS NULL OR condition_question_id <> id);
