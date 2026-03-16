-- ============================================
-- COLLECTIVELIVE — Verify Supabase setup
-- Run this in Supabase SQL Editor to check tables and data
-- ============================================

-- Expected public tables (must match supabase-schema.sql + migrations)
WITH expected AS (
  SELECT unnest(ARRAY[
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'schedule_sessions', 'user_schedule', 'messages', 'announcements',
    'notifications', 'point_rules', 'point_log', 'vendor_booths',
    'meeting_slots', 'meeting_bookings', 'connections', 'connection_requests',
    'blocked_users', 'user_reports', 'session_reminder_sent'
  ]) AS table_name
),
existing AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
)
-- 1a. Report MISSING tables (run main schema or migrations if any show up)
SELECT e.table_name AS missing_table, 'MISSING — run supabase-schema.sql' AS status
FROM expected e
LEFT JOIN existing x ON x.table_name = e.table_name
WHERE x.table_name IS NULL
ORDER BY e.table_name;

-- 1b. List all public tables that exist with column count
SELECT
  t.table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS column_count,
  'OK' AS status
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND t.table_name IN (
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'schedule_sessions', 'user_schedule', 'messages', 'announcements',
    'notifications', 'point_rules', 'point_log', 'vendor_booths',
    'meeting_slots', 'meeting_bookings', 'connections', 'connection_requests',
    'blocked_users', 'user_reports', 'session_reminder_sent'
  )
ORDER BY t.table_name;

-- 2. Row counts for key tables (so you can see if events/point_rules are seeded)
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM public.users
UNION ALL SELECT 'events', COUNT(*) FROM public.events
UNION ALL SELECT 'event_members', COUNT(*) FROM public.event_members
UNION ALL SELECT 'point_rules', COUNT(*) FROM public.point_rules
UNION ALL SELECT 'posts', COUNT(*) FROM public.posts
UNION ALL SELECT 'comments', COUNT(*) FROM public.comments
ORDER BY table_name;

-- 3. Active events (what the app will show)
SELECT id, name, is_active, start_date, end_date
FROM public.events
WHERE is_active = true
ORDER BY start_date DESC;

-- 4. Point rules for the first event (if any)
SELECT e.name AS event_name, pr.action, pr.points_value, pr.max_per_day
FROM public.point_rules pr
JOIN public.events e ON e.id = pr.event_id
ORDER BY e.name, pr.action
LIMIT 20;
