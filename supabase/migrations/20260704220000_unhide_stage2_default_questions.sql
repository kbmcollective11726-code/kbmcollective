-- Unhide Stage 2 default base questions so Registration Details matches Master Build Spec.
-- Admins can still hide individual questions via Matchmaking setup (is_hidden = true).

UPDATE public.event_registration_questions q
SET is_hidden = false
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND q.is_base_question = true
  AND f.audience = 'attendee'
  AND lower(trim(q.prompt)) <> lower('I have read and accept the Terms and Conditions and Code of Conduct');

UPDATE public.event_registration_questions q
SET is_hidden = false
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND q.is_base_question = true
  AND f.audience = 'vendor'
  AND lower(trim(q.prompt)) NOT IN (
    lower('Are you attending the event?'),
    lower('Use Availability'),
    lower('Number Diaries (maximum meetings per slot)'),
    lower('Maximum Meetings'),
    lower('Max Reps'),
    lower('Max Hotel Days'),
    lower('Available for 1-on-1''s'),
    lower('Approved status (Y/N/P)'),
    lower('Company Logo URL')
  );

-- Terms stay visible for Stage 1; hide on Stage 2 via app filter (not DB flag).
