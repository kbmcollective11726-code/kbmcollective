-- Delegate registration: email sign-in (no username/work phone), remove COVID wording.

UPDATE public.event_registration_questions
SET prompt = 'I have read and accept the Terms and Conditions and Code of Conduct'
WHERE is_base_question = true
  AND lower(trim(prompt)) LIKE 'i have read and accept the terms and conditions%';

UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    'username (create one to login in future)',
    'work phone'
  );

UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) NOT IN (
    'cell phone',
    'i have read and accept the terms and conditions and code of conduct'
  );
