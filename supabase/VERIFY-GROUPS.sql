-- Run in Supabase SQL Editor to verify groups and policies.
-- (Uses service role so you see all rows; the app uses RLS so users only see what policies allow.)
--
-- If Query 1 returns NO ROWS: no groups exist. Group creation is failing in the app.
-- → Create a group again in the app and watch for the red "Error creating group" alert.
-- → Use the same Supabase project as your app (.env EXPO_PUBLIC_SUPABASE_URL).

-- 1) All chat_groups in the DB (groups exist?)
SELECT id, event_id, name, created_by, created_at
FROM public.chat_groups
ORDER BY created_at DESC
LIMIT 20;

-- 2) chat_group_members (creator should be in here after app backfill or create)
SELECT cgm.group_id, cgm.user_id, cg.name AS group_name
FROM public.chat_group_members cgm
JOIN public.chat_groups cg ON cg.id = cgm.group_id
ORDER BY cg.created_at DESC
LIMIT 30;

-- 3) Policies on chat_groups (should include "View chat groups: member or event admin or creator")
SELECT policyname, cmd, qual::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chat_groups';
