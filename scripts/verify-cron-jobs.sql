-- Run in Supabase SQL Editor to see which pg_cron jobs exist.
-- Expected for full app behavior (see docs/SUPABASE-LIVE-AUDIT.md):
--   process-scheduled-announcements   (* * * * *)
--   notify-event-starting-soon        (*/2 * * * *)
--   notify-b2b-meeting-soon           (*/2 * * * *)
--   nudge-b2b-meeting-feedback        (*/15 * * * * or similar)
--   auto-deactivate-events            (0 3 * * *)

SELECT jobid, jobname, schedule, command
FROM cron.job
ORDER BY jobname;
