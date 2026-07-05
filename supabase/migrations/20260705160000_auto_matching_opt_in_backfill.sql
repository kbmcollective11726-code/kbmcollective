-- Delegates and vendors with complete profiles are automatically in the matching pool.
-- Portal saves opt them in on first profile completion; backfill existing rows.
UPDATE public.event_registration_submissions s
SET matching_opt_in = true,
    updated_at = now()
FROM public.event_registration_forms f
WHERE s.form_id = f.id
  AND f.audience IN ('attendee', 'vendor')
  AND s.profile_complete = true
  AND s.matching_opt_in = false;
