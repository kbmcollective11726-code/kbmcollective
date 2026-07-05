-- Remove all admin-created custom registration questions (and their answers/options via CASCADE).
-- Portal Stage 2 shows spec default base questions only.

DELETE FROM public.event_registration_questions
WHERE COALESCE(is_base_question, false) = false;

COMMENT ON COLUMN public.event_registration_questions.is_base_question IS
  'True for KBM template defaults (Sections 1–6). False for admin custom questions (Section 7).';
