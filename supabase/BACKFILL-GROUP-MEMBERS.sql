-- ============================================================
-- BACKFILL: Add group creators to chat_group_members
-- Run once in Supabase SQL Editor if your groups show "0 members"
-- and messages don't send or appear.
-- ============================================================
-- This adds the creator (created_by) to chat_group_members for every
-- group where they're not already a row. After running, refresh the
-- app: member counts and group messaging should work.
-- ============================================================

INSERT INTO public.chat_group_members (group_id, user_id)
SELECT cg.id, cg.created_by
FROM public.chat_groups cg
WHERE cg.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_group_members cgm
    WHERE cgm.group_id = cg.id AND cgm.user_id = cg.created_by
  )
ON CONFLICT (group_id, user_id) DO NOTHING;
