-- Enable used_in_matching on spec-aligned scoring questions for delegate and vendor forms.
UPDATE public.event_registration_questions q
SET used_in_matching = true,
    updated_at = now()
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience IN ('attendee', 'vendor')
  AND lower(trim(q.prompt)) IN (
    lower('Meeting Goals'),
    lower('Company''s Annual Revenue'),
    lower('Select your budget for external solutions for 2026'),
    lower('Scope of Responsibility'),
    lower('I sit in the C-suite or report directly to the C-suite'),
    lower('Which seniority levels are you hoping to meet with?'),
    lower('Ideal customer''s revenue range'),
    lower('Budget range you''re hoping your buyer has for 2026'),
    lower('Functions/scope you''re targeting'),
    lower('What are you hoping to get from this event?'),
    lower('What are you hoping to accomplish at this event?')
  );
