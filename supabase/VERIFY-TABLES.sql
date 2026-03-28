-- Run this in Supabase SQL Editor AFTER running APPLY-ALL-MIGRATIONS.sql
-- to verify required tables exist.

SELECT table_name AS "Table", 'OK' AS "Status"
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
  'users', 'events', 'event_members', 'posts', 'likes', 'comments',
  'messages', 'notifications', 'announcements', 'schedule_sessions',
  'user_schedule', 'point_rules', 'point_log', 'connections',
  'connection_requests', 'blocked_users', 'user_reports',
  'chat_groups', 'chat_group_members', 'group_messages', 'chat_group_event',
  'session_reminder_sent', 'vendor_booths', 'meeting_slots',
  'meeting_bookings', 'session_ratings',
  'b2b_meeting_feedback', 'b2b_meeting_feedback_nudge_sent', 'b2b_meeting_reminder_sent'
)
ORDER BY table_name;
