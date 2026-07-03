-- Clear all delegate (attendee) matchmaking registration test data.
-- Keeps vendor/speaker submissions and unrelated auth accounts.

DELETE FROM public.event_registration_submissions
WHERE attendee_type = 'attendee';

DELETE FROM auth.users
WHERE coalesce(raw_user_meta_data->>'attendee_type', '') = 'attendee';
