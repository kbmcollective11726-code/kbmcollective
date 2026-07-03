-- Explicit Data API grants for public tables created in earlier migrations.
-- This keeps behavior stable ahead of Supabase's "new tables require explicit GRANT" rollout.

grant usage on schema public to anon, authenticated;

-- Chat / groups
grant select, insert, update, delete on table public.chat_groups to anon, authenticated;
grant select, insert, update, delete on table public.chat_group_members to anon, authenticated;
grant select, insert, update, delete on table public.group_messages to anon, authenticated;

-- Session ratings / feedback
grant select, insert, update, delete on table public.session_ratings to anon, authenticated;
grant select, insert, update, delete on table public.b2b_meeting_feedback to anon, authenticated;
grant select, insert, update, delete on table public.b2b_meeting_feedback_nudge_sent to anon, authenticated;
grant select, insert, update, delete on table public.b2b_meeting_reminder_sent to anon, authenticated;

-- Vendor / booths
grant select, insert, update, delete on table public.vendor_booth_reps to anon, authenticated;

-- Matchmaking / registration
grant select, insert, update, delete on table public.event_matchmaking_settings to anon, authenticated;
grant select, insert, update, delete on table public.event_registration_forms to anon, authenticated;
grant select, insert, update, delete on table public.event_registration_questions to anon, authenticated;
grant select, insert, update, delete on table public.event_registration_question_options to anon, authenticated;
grant select, insert, update, delete on table public.event_registration_submissions to anon, authenticated;
grant select, insert, update, delete on table public.event_registration_answers to anon, authenticated;
grant select, insert, update, delete on table public.event_meeting_interest_requests to anon, authenticated;
grant select, insert, update, delete on table public.event_match_reviews to anon, authenticated;
grant select, insert, update, delete on table public.event_match_scheduled_meetings to anon, authenticated;

-- Sponsors
grant select, insert, update, delete on table public.event_sponsors to anon, authenticated;

-- Platform test guides
grant select, insert, update, delete on table public.platform_test_guides to anon, authenticated;
