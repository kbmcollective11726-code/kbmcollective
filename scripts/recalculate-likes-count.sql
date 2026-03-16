-- Recalculate posts.likes_count from the actual likes table.
-- Run this in Supabase SQL Editor if like counts ever get out of sync
-- (e.g. before the update_likes_count trigger was added, or after manual data changes).

UPDATE public.posts p
SET likes_count = COALESCE(
  (SELECT COUNT(*)::int FROM public.likes l WHERE l.post_id = p.id),
  0
)
WHERE p.likes_count IS DISTINCT FROM (
  SELECT COUNT(*)::int FROM public.likes l WHERE l.post_id = p.id
);

-- Optional: show how many rows were corrected (run separately if you want to check first)
-- SELECT p.id, p.likes_count AS stored_count,
--        (SELECT COUNT(*) FROM public.likes l WHERE l.post_id = p.id) AS actual_count
-- FROM public.posts p
-- WHERE p.likes_count != (SELECT COUNT(*) FROM public.likes l WHERE l.post_id = p.id);
