-- Lean default visibility for matchmaking registration base questions.
-- Event admins can show hidden questions per event in Matchmaking setup.

-- Delegate (attendee)
UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) NOT IN (
    'username (create one to login in future)',
    'work phone',
    'cell phone',
    'i have read and accept the terms and conditions, code of conduct & covid waiver'
  );

-- Vendor
UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'vendor'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) NOT IN (
    'username',
    'company description',
    'company logo image',
    'company website',
    'are you sending representatives to the event onsite?',
    'will your team take meetings virtually?'
  );

-- Speaker (stored as audience = user)
UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'user'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) NOT IN (
    'username (create one to login in future)',
    'work phone',
    'cell phone',
    'speaker bio',
    'speaker headshot',
    'i have read and accept the terms and conditions, code of conduct & covid waiver'
  );

-- Legacy vendor ops prompts — always hidden
UPDATE public.event_registration_questions q
SET is_hidden = true
WHERE q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    'are you attending the event?',
    'use availability',
    'number diaries (maximum meetings per slot)',
    'maximum meetings',
    'max reps',
    'max hotel days',
    'available for 1-on-1''s',
    'approved status (y/n/p)',
    'company logo url'
  );
