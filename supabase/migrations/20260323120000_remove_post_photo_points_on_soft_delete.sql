-- When a post is soft-deleted, remove the poster's post_photo point_log row and recalc event_members.points.

CREATE OR REPLACE FUNCTION public.remove_points_on_post_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.is_deleted IS TRUE
     AND COALESCE(OLD.is_deleted, FALSE) IS NOT TRUE
  THEN
    DELETE FROM public.point_log
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id
      AND action = 'post_photo'
      AND reference_id = NEW.id;

    UPDATE public.event_members em
    SET points = (
      SELECT COALESCE(SUM(pl.points), 0)::integer
      FROM public.point_log pl
      WHERE pl.user_id = em.user_id AND pl.event_id = em.event_id
    )
    WHERE em.event_id = NEW.event_id
      AND em.user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_post_soft_delete_remove_post_photo_points ON public.posts;
CREATE TRIGGER on_post_soft_delete_remove_post_photo_points
  AFTER UPDATE OF is_deleted ON public.posts
  FOR EACH ROW
  WHEN (NEW.is_deleted IS TRUE AND COALESCE(OLD.is_deleted, FALSE) IS NOT TRUE)
  EXECUTE FUNCTION public.remove_points_on_post_soft_delete();

COMMENT ON FUNCTION public.remove_points_on_post_soft_delete() IS
  'Removes post_photo point_log for the author when a post is soft-deleted; recalculates event_members.points.';
