-- Performance: missing FK indexes + RLS initplan / permissive-policy cleanup.

-- 1) Covering indexes for unindexed foreign keys
CREATE INDEX IF NOT EXISTS event_match_scheduled_meetings_app_booking_id_idx
  ON public.event_match_scheduled_meetings (app_booking_id);

CREATE INDEX IF NOT EXISTS event_meeting_interest_requests_target_submission_id_idx
  ON public.event_meeting_interest_requests (target_submission_id);

CREATE INDEX IF NOT EXISTS event_registration_solution_categories_category_id_idx
  ON public.event_registration_solution_categories (category_id);

-- 2) comment_likes: wrap auth.uid() in (select ...)
DROP POLICY IF EXISTS "Users can like comments" ON public.comment_likes;
CREATE POLICY "Users can like comments" ON public.comment_likes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can unlike comments" ON public.comment_likes;
CREATE POLICY "Users can unlike comments" ON public.comment_likes
  AS PERMISSIVE FOR DELETE TO public
  USING (((SELECT auth.uid()) = user_id));

-- 3) event_registration_solution_categories: drop redundant SELECT
--    (event_reg_solution_cats_manage FOR ALL already covers SELECT with the same check)
DROP POLICY IF EXISTS "event_reg_solution_cats_select" ON public.event_registration_solution_categories;

-- 4) event_solution_categories: split admin ALL into write-only so only one SELECT policy remains
DROP POLICY IF EXISTS "event_solution_categories_admin" ON public.event_solution_categories;

CREATE POLICY "event_solution_categories_insert" ON public.event_solution_categories
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));

CREATE POLICY "event_solution_categories_update" ON public.event_solution_categories
  AS PERMISSIVE FOR UPDATE TO public
  USING (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())))
  WITH CHECK (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));

CREATE POLICY "event_solution_categories_delete" ON public.event_solution_categories
  AS PERMISSIVE FOR DELETE TO public
  USING (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));

-- Keep existing event_solution_categories_select_perm as the sole SELECT policy.

-- 5) event_sponsor_creatives: wrap auth.uid(); single SELECT; write policies for admins
DROP POLICY IF EXISTS "Event admins manage sponsor creatives" ON public.event_sponsor_creatives;
DROP POLICY IF EXISTS "Event members can view sponsor creatives" ON public.event_sponsor_creatives;
DROP POLICY IF EXISTS "Public read live wall sponsor creatives" ON public.event_sponsor_creatives;

CREATE POLICY "event_sponsor_creatives_select" ON public.event_sponsor_creatives
  AS PERMISSIVE FOR SELECT TO public
  USING (
    is_platform_admin((SELECT auth.uid()))
    OR is_event_admin(event_id)
    OR EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = event_sponsor_creatives.event_id
        AND em.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_sponsors s
      JOIN public.events e ON e.id = s.event_id
      WHERE s.id = event_sponsor_creatives.sponsor_id
        AND s.event_id = event_sponsor_creatives.event_id
        AND s.is_active = true
        AND s.show_on_live_wall = true
        AND e.is_active = true
    )
  );

CREATE POLICY "event_sponsor_creatives_insert" ON public.event_sponsor_creatives
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));

CREATE POLICY "event_sponsor_creatives_update" ON public.event_sponsor_creatives
  AS PERMISSIVE FOR UPDATE TO public
  USING (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())))
  WITH CHECK (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));

CREATE POLICY "event_sponsor_creatives_delete" ON public.event_sponsor_creatives
  AS PERMISSIVE FOR DELETE TO public
  USING (is_event_admin(event_id) OR is_platform_admin((SELECT auth.uid())));
