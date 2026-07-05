-- Backfill delegate Registration Details section labels for clear grouped UI.

UPDATE public.event_registration_questions q
SET section_label = CASE lower(trim(q.prompt))
  WHEN lower('Company Name') THEN 'Identity & contact'
  WHEN lower('First Name') THEN 'Identity & contact'
  WHEN lower('Last Name') THEN 'Identity & contact'
  WHEN lower('Job Title') THEN 'Identity & contact'
  WHEN lower('E-Mail Address') THEN 'Identity & contact'
  WHEN lower('Work Phone') THEN 'Identity & contact'
  WHEN lower('Cell Phone') THEN 'Identity & contact'
  WHEN lower('How did you hear about this event?') THEN 'Identity & contact'
  WHEN lower('Dietary Restrictions') THEN 'Identity & contact'
  WHEN lower('Preferred Pronouns') THEN 'Identity & contact'
  WHEN lower('Address') THEN 'Company information'
  WHEN lower('City') THEN 'Company information'
  WHEN lower('State/Province') THEN 'Company information'
  WHEN lower('Zip Code/Postal Code') THEN 'Company information'
  WHEN lower('Country') THEN 'Company information'
  WHEN lower('Assistant First Name') THEN 'Company information'
  WHEN lower('Assistant Last Name') THEN 'Company information'
  WHEN lower('Assistant Email') THEN 'Company information'
  WHEN lower('Assistant Work Phone') THEN 'Company information'
  WHEN lower('Solution Category of Interest') THEN 'Solution interest'
  WHEN lower('Meeting Goals') THEN 'Meeting preferences'
  WHEN lower('What are you hoping to get from this event?') THEN 'Meeting preferences'
  WHEN lower('Headshot/Photo') THEN 'Profile'
  ELSE q.section_label
END
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true;

UPDATE public.event_registration_questions q
SET section_label = 'Meeting preferences'
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND lower(trim(q.section_label)) = lower('Meeting preferences & matching');

UPDATE public.event_registration_questions q
SET section_label = 'Profile'
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND lower(trim(q.section_label)) = lower('Profile & event logistics');
