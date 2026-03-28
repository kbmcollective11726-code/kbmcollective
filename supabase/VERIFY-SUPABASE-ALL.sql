-- =============================================================================
-- FULL SUPABASE CHECK — run entire file in Dashboard → SQL Editor (postgres)
-- =============================================================================
-- Confirms: extensions, public tables, pg_cron jobs.
-- Also run separately: CHECK-TABLES-AND-COLUMNS.sql (column-level).
-- Dashboard: Edge Functions list vs docs/SUPABASE-LIVE-AUDIT.md
-- Secrets: Vault (project_url, anon_key, cron_secret) + CRON_SECRET on cron functions
-- =============================================================================

-- 1) Extensions (need pg_cron + pg_net for scheduled pushes; vault for cron HTTP)
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net', 'supabase_vault', 'vault')
ORDER BY extname;

-- 2) Required public tables (MISSING = row with Status = MISSING)
SELECT
  required.table_name AS "Table",
  CASE WHEN t.table_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS "Status"
FROM (
  SELECT unnest(ARRAY[
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'messages', 'notifications', 'announcements', 'schedule_sessions',
    'user_schedule', 'point_rules', 'point_log', 'connections',
    'connection_requests', 'blocked_users', 'user_reports',
    'chat_groups', 'chat_group_members', 'group_messages', 'chat_group_event',
    'session_reminder_sent', 'vendor_booths', 'meeting_slots', 'meeting_bookings',
    'session_ratings',
    'b2b_meeting_feedback', 'b2b_meeting_feedback_nudge_sent', 'b2b_meeting_reminder_sent'
  ]) AS table_name
) required
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = required.table_name
ORDER BY "Status" DESC, "Table";

-- 3) Storage bucket used by app (avatars) — create in Dashboard if missing
SELECT id, name, public FROM storage.buckets WHERE id = 'avatars';

-- 4) pg_cron jobs (expect 5 named jobs — see scripts/verify-cron-jobs.sql).
--    If this errors with "relation cron.job does not exist", enable extension pg_cron first.
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;
