-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor to verify setup.
-- Copy the whole file and Run. Check the result of each section below.
-- ============================================================

-- 1) Helper functions (required for group chat and other RLS)
SELECT '1. Helper functions' AS check_name, COUNT(*)::text AS result
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('is_event_admin', 'is_platform_admin');
-- Expect result: 2. If 0, run RUN-IN-SQL-EDITOR.sql again.

-- 2) users.is_platform_admin column
SELECT '2. users.is_platform_admin column' AS check_name, COUNT(*)::text AS result
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_platform_admin';
-- Expect result: 1. If 0, run RUN-IN-SQL-EDITOR.sql again.

-- 3) Group chat tables
SELECT '3. Group chat tables' AS check_name, COUNT(*)::text AS result
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('chat_groups', 'chat_group_members', 'group_messages');
-- Expect result: 3. If less, the group chat migration may not have been applied.

-- 4) messages attachment columns (DMs with images)
SELECT '4. messages attachment columns' AS check_name, COUNT(*)::text AS result
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'messages'
  AND column_name IN ('attachment_url', 'attachment_type');
-- Expect result: 2. If 0, optional; DMs work but without image attachments.

-- 5) chat_groups policies (need INSERT + one SELECT that avoids recursion)
SELECT '5. chat_groups policies' AS check_name, string_agg(policyname, ', ' ORDER BY policyname) AS result
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chat_groups';
-- Expect: "Admins can create chat groups" and "View chat groups: member or event admin". 
-- If you see "Members can view chat groups they are in" without "View chat groups: member or event admin", run RUN-IN-SQL-EDITOR.sql again.

-- 6) chat_group_members policies
SELECT '6. chat_group_members policies' AS check_name, string_agg(policyname, ', ' ORDER BY policyname) AS result
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chat_group_members';
-- Expect at least: "Admins can manage chat group members", "Members can view chat group members".

-- 7) group_messages policies
SELECT '7. group_messages policies' AS check_name, string_agg(policyname, ', ' ORDER BY policyname) AS result
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_messages';
-- Expect: "Group members can view messages", "Group members can send messages".

-- 8) Core app tables (quick sanity check)
SELECT '8. Core tables exist' AS check_name, COUNT(*)::text AS result
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'events', 'event_members', 'posts', 'messages', 'notifications', 'chat_groups', 'chat_group_members', 'group_messages');
-- Expect result: 9 (or 8 if group chat not applied yet).
