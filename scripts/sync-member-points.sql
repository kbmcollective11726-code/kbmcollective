-- ============================================
-- Sync event_members.points from point_log
-- Run in Supabase SQL Editor if leaderboard
-- shows 0 pts for users who posted/liked/commented.
-- ============================================

-- Recalculate each member's points from their point_log total
UPDATE public.event_members em
SET points = COALESCE(
  (
    SELECT SUM(pl.points)::integer
    FROM public.point_log pl
    WHERE pl.user_id = em.user_id
      AND pl.event_id = em.event_id
  ),
  0
);
