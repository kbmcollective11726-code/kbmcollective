-- Mark seeded KBM questions as base/locked defaults.
ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS is_base_question BOOLEAN NOT NULL DEFAULT false;
