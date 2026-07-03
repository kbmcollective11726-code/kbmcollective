-- Cell phone is collected in the delegate registration header grid; drop legacy section label.

UPDATE public.event_registration_questions q
SET section_label = NULL
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND lower(trim(q.prompt)) = 'cell phone';

UPDATE public.event_registration_questions q
SET section_label = NULL
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND lower(trim(q.prompt)) IN (
    'username (create one to login in future)',
    'work phone',
    'company name'
  );
