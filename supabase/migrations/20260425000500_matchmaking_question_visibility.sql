-- Allow event admins to hide individual default questions per event.
ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
