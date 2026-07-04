-- Wave 2a: auth_rls_initplan performance fix
-- Wrap auth.uid()/auth.role()/auth.jwt() in (select ...) so Postgres
-- evaluates them once per query instead of once per row.
-- Access logic is IDENTICAL; only evaluation timing changes.
-- Runs as a single transaction: all 103 policies swap atomically or none do.

-- announcements | DELETE | Admins can delete announcements
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
CREATE POLICY "Admins can delete announcements" ON public.announcements AS PERMISSIVE FOR DELETE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- announcements | INSERT | Admins can create announcements
DROP POLICY IF EXISTS "Admins can create announcements" ON public.announcements;
CREATE POLICY "Admins can create announcements" ON public.announcements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- announcements | SELECT | Announcements visible to targets
DROP POLICY IF EXISTS "Announcements visible to targets" ON public.announcements;
CREATE POLICY "Announcements visible to targets" ON public.announcements AS PERMISSIVE FOR SELECT TO public
  USING ((user_can_view_announcement(event_id, target_type, target_audience, target_user_ids) AND ((scheduled_at IS NULL) OR (sent_at IS NOT NULL) OR is_platform_admin((select auth.uid())) OR is_event_admin(event_id))));

-- announcements | UPDATE | Admins can update announcements
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
CREATE POLICY "Admins can update announcements" ON public.announcements AS PERMISSIVE FOR UPDATE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- b2b_meeting_feedback | INSERT | Attendee can insert own B2B feedback
DROP POLICY IF EXISTS "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM meeting_bookings mb
  WHERE ((mb.id = b2b_meeting_feedback.booking_id) AND (mb.attendee_id = (select auth.uid())))))));

-- b2b_meeting_feedback | SELECT | Event admins can view all B2B feedback in event
DROP POLICY IF EXISTS "Event admins can view all B2B feedback in event" ON public.b2b_meeting_feedback;
CREATE POLICY "Event admins can view all B2B feedback in event" ON public.b2b_meeting_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ((meeting_bookings mb
     JOIN meeting_slots ms ON ((ms.id = mb.slot_id)))
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((mb.id = b2b_meeting_feedback.booking_id) AND (is_event_admin(vb.event_id) OR is_platform_admin((select auth.uid())))))));

-- b2b_meeting_feedback | SELECT | Users can view own B2B feedback
DROP POLICY IF EXISTS "Users can view own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Users can view own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (select auth.uid())));

-- b2b_meeting_feedback | UPDATE | Attendee can update own B2B feedback
DROP POLICY IF EXISTS "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback;
CREATE POLICY "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

-- b2b_meeting_feedback_nudge_sent | SELECT | Event admins can view B2B nudge sent
DROP POLICY IF EXISTS "Event admins can view B2B nudge sent" ON public.b2b_meeting_feedback_nudge_sent;
CREATE POLICY "Event admins can view B2B nudge sent" ON public.b2b_meeting_feedback_nudge_sent AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ((meeting_bookings mb
     JOIN meeting_slots ms ON ((ms.id = mb.slot_id)))
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((mb.id = b2b_meeting_feedback_nudge_sent.booking_id) AND (is_event_admin(vb.event_id) OR is_platform_admin((select auth.uid())))))));

-- badge_scan_meeting_attendance | SELECT | BSMA event admin read
DROP POLICY IF EXISTS "BSMA event admin read" ON public.badge_scan_meeting_attendance;
CREATE POLICY "BSMA event admin read" ON public.badge_scan_meeting_attendance AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- badge_scan_meeting_attendance | SELECT | BSMA scanner read own
DROP POLICY IF EXISTS "BSMA scanner read own" ON public.badge_scan_meeting_attendance;
CREATE POLICY "BSMA scanner read own" ON public.badge_scan_meeting_attendance AS PERMISSIVE FOR SELECT TO public
  USING ((scanner_user_id = (select auth.uid())));

-- badge_scans | SELECT | Badge scans admin read
DROP POLICY IF EXISTS "Badge scans admin read" ON public.badge_scans;
CREATE POLICY "Badge scans admin read" ON public.badge_scans AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- badge_scans | SELECT | Badge scans scanner read own
DROP POLICY IF EXISTS "Badge scans scanner read own" ON public.badge_scans;
CREATE POLICY "Badge scans scanner read own" ON public.badge_scans AS PERMISSIVE FOR SELECT TO public
  USING ((scanner_user_id = (select auth.uid())));

-- blocked_users | DELETE | Users can delete own blocks
DROP POLICY IF EXISTS "Users can delete own blocks" ON public.blocked_users;
CREATE POLICY "Users can delete own blocks" ON public.blocked_users AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = blocker_id));

-- blocked_users | INSERT | Users can insert own blocks
DROP POLICY IF EXISTS "Users can insert own blocks" ON public.blocked_users;
CREATE POLICY "Users can insert own blocks" ON public.blocked_users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = blocker_id));

-- blocked_users | SELECT | Users can view blocks they are party to
DROP POLICY IF EXISTS "Users can view blocks they are party to" ON public.blocked_users;
CREATE POLICY "Users can view blocks they are party to" ON public.blocked_users AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = blocker_id) OR ((select auth.uid()) = blocked_user_id)));

-- chat_group_members | INSERT | Creators can add themselves to chat group members
DROP POLICY IF EXISTS "Creators can add themselves to chat group members" ON public.chat_group_members;
CREATE POLICY "Creators can add themselves to chat group members" ON public.chat_group_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND (user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM chat_groups g
  WHERE ((g.id = chat_group_members.group_id) AND (g.created_by = (select auth.uid())))))));

-- chat_group_members | SELECT | Members can view chat group members
DROP POLICY IF EXISTS "Members can view chat group members" ON public.chat_group_members;
CREATE POLICY "Members can view chat group members" ON public.chat_group_members AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) IS NOT NULL) AND (can_manage_chat_group_members(group_id) OR is_member_of_chat_group(group_id, (select auth.uid())))));

-- chat_groups | DELETE | Admins can delete chat groups
DROP POLICY IF EXISTS "Admins can delete chat groups" ON public.chat_groups;
CREATE POLICY "Admins can delete chat groups" ON public.chat_groups AS PERMISSIVE FOR DELETE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- chat_groups | INSERT | Admins can create chat groups
DROP POLICY IF EXISTS "Admins can create chat groups" ON public.chat_groups;
CREATE POLICY "Admins can create chat groups" ON public.chat_groups AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- chat_groups | SELECT | Event members and creator can view chat groups in event
DROP POLICY IF EXISTS "Event members and creator can view chat groups in event" ON public.chat_groups;
CREATE POLICY "Event members and creator can view chat groups in event" ON public.chat_groups AS PERMISSIVE FOR SELECT TO public
  USING (((created_by = (select auth.uid())) OR is_event_admin(event_id) OR is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = chat_groups.event_id) AND (em.user_id = (select auth.uid())))))));

-- chat_groups | SELECT | View chat groups: member or event admin or creator
DROP POLICY IF EXISTS "View chat groups: member or event admin or creator" ON public.chat_groups;
CREATE POLICY "View chat groups: member or event admin or creator" ON public.chat_groups AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) IS NOT NULL) AND ((created_by = (select auth.uid())) OR is_event_admin(event_id) OR is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = chat_groups.event_id) AND (em.user_id = (select auth.uid()))))) OR is_member_of_chat_group(id, (select auth.uid())))));

-- chat_groups | UPDATE | Admins can update chat groups
DROP POLICY IF EXISTS "Admins can update chat groups" ON public.chat_groups;
CREATE POLICY "Admins can update chat groups" ON public.chat_groups AS PERMISSIVE FOR UPDATE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- comments | DELETE | Users can delete own comments
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
CREATE POLICY "Users can delete own comments" ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- comments | INSERT | Users can comment
DROP POLICY IF EXISTS "Users can comment" ON public.comments;
CREATE POLICY "Users can comment" ON public.comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- connection_requests | INSERT | Users can send connection request
DROP POLICY IF EXISTS "Users can send connection request" ON public.connection_requests;
CREATE POLICY "Users can send connection request" ON public.connection_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) = requester_id) AND (NOT users_have_block(requester_id, requested_user_id))));

-- connection_requests | SELECT | Connection requests viewable
DROP POLICY IF EXISTS "Connection requests viewable" ON public.connection_requests;
CREATE POLICY "Connection requests viewable" ON public.connection_requests AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = requester_id) OR ((select auth.uid()) = requested_user_id)));

-- connection_requests | UPDATE | Requested user can update request
DROP POLICY IF EXISTS "Requested user can update request" ON public.connection_requests;
CREATE POLICY "Requested user can update request" ON public.connection_requests AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = requested_user_id))
  WITH CHECK ((((select auth.uid()) = requested_user_id) AND ((status IS DISTINCT FROM 'accepted'::text) OR (NOT users_have_block(requester_id, requested_user_id)))));

-- connections | DELETE | Users can disconnect
DROP POLICY IF EXISTS "Users can disconnect" ON public.connections;
CREATE POLICY "Users can disconnect" ON public.connections AS PERMISSIVE FOR DELETE TO public
  USING ((((select auth.uid()) = user_id) OR ((select auth.uid()) = connected_user_id)));

-- connections | INSERT | Users can connect
DROP POLICY IF EXISTS "Users can connect" ON public.connections;
CREATE POLICY "Users can connect" ON public.connections AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((((select auth.uid()) = user_id) OR ((select auth.uid()) = connected_user_id)) AND (NOT users_have_block(user_id, connected_user_id))));

-- connections | SELECT | Connections viewable
DROP POLICY IF EXISTS "Connections viewable" ON public.connections;
CREATE POLICY "Connections viewable" ON public.connections AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = user_id) OR ((select auth.uid()) = connected_user_id)));

-- event_badge_tokens | SELECT | Event admins read badge tokens
DROP POLICY IF EXISTS "Event admins read badge tokens" ON public.event_badge_tokens;
CREATE POLICY "Event admins read badge tokens" ON public.event_badge_tokens AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_match_reviews | ALL | Event admins manage match reviews
DROP POLICY IF EXISTS "Event admins manage match reviews" ON public.event_match_reviews;
CREATE POLICY "Event admins manage match reviews" ON public.event_match_reviews AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_match_scheduled_meetings | ALL | Event admins manage scheduled matches
DROP POLICY IF EXISTS "Event admins manage scheduled matches" ON public.event_match_scheduled_meetings;
CREATE POLICY "Event admins manage scheduled matches" ON public.event_match_scheduled_meetings AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_matchmaking_settings | ALL | Event admins manage matchmaking settings
DROP POLICY IF EXISTS "Event admins manage matchmaking settings" ON public.event_matchmaking_settings;
CREATE POLICY "Event admins manage matchmaking settings" ON public.event_matchmaking_settings AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_matchmaking_settings | SELECT | Public read open matchmaking settings
DROP POLICY IF EXISTS "Public read open matchmaking settings" ON public.event_matchmaking_settings;
CREATE POLICY "Public read open matchmaking settings" ON public.event_matchmaking_settings AS PERMISSIVE FOR SELECT TO public
  USING (((registration_open = true) OR is_event_admin(event_id) OR is_platform_admin((select auth.uid())) OR has_submitted_delegate_registration(event_id)));

-- event_meeting_interest_requests | ALL | Members manage meeting interest requests in own submissions
DROP POLICY IF EXISTS "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests AS PERMISSIVE FOR ALL TO public
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (is_event_meeting_requests_open(event_id) AND (EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND ((s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))))))
  WITH CHECK ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (is_event_meeting_requests_open(event_id) AND (EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND ((s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))))));

-- event_meeting_interest_requests | SELECT | Members read meeting interest requests in own submissions
DROP POLICY IF EXISTS "Members read meeting interest requests in own submissions" ON public.event_meeting_interest_requests;
CREATE POLICY "Members read meeting interest requests in own submissions" ON public.event_meeting_interest_requests AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(s.event_id) OR (s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))));

-- event_members | ALL | Platform admins can manage event members
DROP POLICY IF EXISTS "Platform admins can manage event members" ON public.event_members;
CREATE POLICY "Platform admins can manage event members" ON public.event_members AS PERMISSIVE FOR ALL TO public
  USING (is_platform_admin((select auth.uid())));

-- event_members | INSERT | Users can join events
DROP POLICY IF EXISTS "Users can join events" ON public.event_members;
CREATE POLICY "Users can join events" ON public.event_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- event_members | UPDATE | Users can update own role
DROP POLICY IF EXISTS "Users can update own role" ON public.event_members;
CREATE POLICY "Users can update own role" ON public.event_members AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id))
  WITH CHECK ((((select auth.uid()) = user_id) AND (role = ANY (ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text]))));

-- event_registration_answers | ALL | Members manage answers in own submissions
DROP POLICY IF EXISTS "Members manage answers in own submissions" ON public.event_registration_answers;
CREATE POLICY "Members manage answers in own submissions" ON public.event_registration_answers AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(s.event_id) OR (s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(s.event_id) OR (s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))));

-- event_registration_answers | SELECT | Members read answers in own submissions
DROP POLICY IF EXISTS "Members read answers in own submissions" ON public.event_registration_answers;
CREATE POLICY "Members read answers in own submissions" ON public.event_registration_answers AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(s.event_id) OR (s.user_id = (select auth.uid())) OR registration_submission_owned_by_auth(s.id))))));

-- event_registration_forms | ALL | Event admins manage registration forms
DROP POLICY IF EXISTS "Event admins manage registration forms" ON public.event_registration_forms;
CREATE POLICY "Event admins manage registration forms" ON public.event_registration_forms AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_registration_forms | SELECT | Event members can view registration forms
DROP POLICY IF EXISTS "Event members can view registration forms" ON public.event_registration_forms;
CREATE POLICY "Event members can view registration forms" ON public.event_registration_forms AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = event_registration_forms.event_id) AND (em.user_id = (select auth.uid())))))));

-- event_registration_question_options | ALL | Event admins manage question options
DROP POLICY IF EXISTS "Event admins manage question options" ON public.event_registration_question_options;
CREATE POLICY "Event admins manage question options" ON public.event_registration_question_options AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_event_admin(f.event_id) OR is_platform_admin((select auth.uid())))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_event_admin(f.event_id) OR is_platform_admin((select auth.uid())))))));

-- event_registration_question_options | SELECT | Event members can view question options
DROP POLICY IF EXISTS "Event members can view question options" ON public.event_registration_question_options;
CREATE POLICY "Event members can view question options" ON public.event_registration_question_options AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(f.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = f.event_id) AND (em.user_id = (select auth.uid()))))))))));

-- event_registration_questions | ALL | Event admins manage registration questions
DROP POLICY IF EXISTS "Event admins manage registration questions" ON public.event_registration_questions;
CREATE POLICY "Event admins manage registration questions" ON public.event_registration_questions AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_event_admin(f.event_id) OR is_platform_admin((select auth.uid())))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_event_admin(f.event_id) OR is_platform_admin((select auth.uid())))))));

-- event_registration_questions | SELECT | Event members can view registration questions
DROP POLICY IF EXISTS "Event members can view registration questions" ON public.event_registration_questions;
CREATE POLICY "Event members can view registration questions" ON public.event_registration_questions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_platform_admin((select auth.uid())) OR is_event_admin(f.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = f.event_id) AND (em.user_id = (select auth.uid()))))))))));

-- event_registration_submissions | DELETE | Event admins delete submissions
DROP POLICY IF EXISTS "Event admins delete submissions" ON public.event_registration_submissions;
CREATE POLICY "Event admins delete submissions" ON public.event_registration_submissions AS PERMISSIVE FOR DELETE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_registration_submissions | INSERT | Members can create own submissions
DROP POLICY IF EXISTS "Members can create own submissions" ON public.event_registration_submissions;
CREATE POLICY "Members can create own submissions" ON public.event_registration_submissions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (user_id = (select auth.uid()))));

-- event_registration_submissions | SELECT | Members read submissions in their events
DROP POLICY IF EXISTS "Members read submissions in their events" ON public.event_registration_submissions;
CREATE POLICY "Members read submissions in their events" ON public.event_registration_submissions AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (user_id = (select auth.uid())) OR registration_submission_owned_by_auth(id)));

-- event_registration_submissions | UPDATE | Members update own submissions
DROP POLICY IF EXISTS "Members update own submissions" ON public.event_registration_submissions;
CREATE POLICY "Members update own submissions" ON public.event_registration_submissions AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (user_id = (select auth.uid())) OR registration_submission_owned_by_auth(id)))
  WITH CHECK ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (user_id = (select auth.uid())) OR registration_submission_owned_by_auth(id)));

-- event_sponsor_clicks | INSERT | Event members log sponsor clicks
DROP POLICY IF EXISTS "Event members log sponsor clicks" ON public.event_sponsor_clicks;
CREATE POLICY "Event members log sponsor clicks" ON public.event_sponsor_clicks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = (select auth.uid())) AND (is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = event_sponsor_clicks.event_id) AND (em.user_id = (select auth.uid())))))) AND (EXISTS ( SELECT 1
   FROM event_sponsors s
  WHERE ((s.id = event_sponsor_clicks.sponsor_id) AND (s.event_id = event_sponsor_clicks.event_id) AND (s.is_active = true))))));

-- event_sponsor_clicks | SELECT | Event admins read sponsor clicks
DROP POLICY IF EXISTS "Event admins read sponsor clicks" ON public.event_sponsor_clicks;
CREATE POLICY "Event admins read sponsor clicks" ON public.event_sponsor_clicks AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id)));

-- event_sponsors | ALL | Event admins manage event sponsors
DROP POLICY IF EXISTS "Event admins manage event sponsors" ON public.event_sponsors;
CREATE POLICY "Event admins manage event sponsors" ON public.event_sponsors AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- event_sponsors | SELECT | Event members can view event sponsors
DROP POLICY IF EXISTS "Event members can view event sponsors" ON public.event_sponsors;
CREATE POLICY "Event members can view event sponsors" ON public.event_sponsors AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin((select auth.uid())) OR is_event_admin(event_id) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = event_sponsors.event_id) AND (em.user_id = (select auth.uid())))))));

-- events | ALL | Admins can manage events
DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
CREATE POLICY "Admins can manage events" ON public.events AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_members
  WHERE ((event_members.user_id = (select auth.uid())) AND (event_members.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));

-- events | DELETE | Super admins can delete events
DROP POLICY IF EXISTS "Super admins can delete events" ON public.events;
CREATE POLICY "Super admins can delete events" ON public.events AS PERMISSIVE FOR DELETE TO public
  USING ((is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = (select auth.uid())) AND ((em.role = 'super_admin'::text) OR ('super_admin'::text = ANY (COALESCE(em.roles, ARRAY[]::text[])))))))));

-- events | INSERT | Authenticated users can create events
DROP POLICY IF EXISTS "Authenticated users can create events" ON public.events;
CREATE POLICY "Authenticated users can create events" ON public.events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) IS NOT NULL));

-- events | SELECT | Events are viewable by everyone
DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;
CREATE POLICY "Events are viewable by everyone" ON public.events AS PERMISSIVE FOR SELECT TO public
  USING (((is_active = true) OR is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = (select auth.uid())))))));

-- events | UPDATE | Admins can update events
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
CREATE POLICY "Admins can update events" ON public.events AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = (select auth.uid())) AND (em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))));

-- group_messages | INSERT | Group members can send messages
DROP POLICY IF EXISTS "Group members can send messages" ON public.group_messages;
CREATE POLICY "Group members can send messages" ON public.group_messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) IS NOT NULL) AND ((select auth.uid()) = sender_id) AND (EXISTS ( SELECT 1
   FROM chat_group_members cgm
  WHERE ((cgm.group_id = group_messages.group_id) AND (cgm.user_id = (select auth.uid())))))));

-- group_messages | SELECT | Group members can view messages
DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
CREATE POLICY "Group members can view messages" ON public.group_messages AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM chat_group_members cgm
  WHERE ((cgm.group_id = group_messages.group_id) AND (cgm.user_id = (select auth.uid())))))));

-- likes | DELETE | Users can unlike
DROP POLICY IF EXISTS "Users can unlike" ON public.likes;
CREATE POLICY "Users can unlike" ON public.likes AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- likes | INSERT | Users can like
DROP POLICY IF EXISTS "Users can like" ON public.likes;
CREATE POLICY "Users can like" ON public.likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- meeting_bookings | INSERT | Admins can assign meeting bookings
DROP POLICY IF EXISTS "Admins can assign meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))));

-- meeting_bookings | SELECT | Booth reps and event admins can view booth bookings
DROP POLICY IF EXISTS "Booth reps and event admins can view booth bookings" ON public.meeting_bookings;
CREATE POLICY "Booth reps and event admins can view booth bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND (is_event_admin(vb.event_id) OR (vb.contact_user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM vendor_booth_reps vbr
          WHERE ((vbr.booth_id = vb.id) AND (vbr.user_id = (select auth.uid()))))))))));

-- meeting_bookings | SELECT | Platform admins can view meeting bookings
DROP POLICY IF EXISTS "Platform admins can view meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Platform admins can view meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING (is_platform_admin((select auth.uid())));

-- meeting_bookings | SELECT | Users see own bookings
DROP POLICY IF EXISTS "Users see own bookings" ON public.meeting_bookings;
CREATE POLICY "Users see own bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = attendee_id));

-- meeting_bookings | UPDATE | Admins can update meeting bookings
DROP POLICY IF EXISTS "Admins can update meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))))
  WITH CHECK ((is_platform_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))));

-- meeting_slots | ALL | Platform admins manage slots
DROP POLICY IF EXISTS "Platform admins manage slots" ON public.meeting_slots;
CREATE POLICY "Platform admins manage slots" ON public.meeting_slots AS PERMISSIVE FOR ALL TO public
  USING (is_platform_admin((select auth.uid())))
  WITH CHECK (is_platform_admin((select auth.uid())));

-- meeting_slots | ALL | Vendors manage slots
DROP POLICY IF EXISTS "Vendors manage slots" ON public.meeting_slots;
CREATE POLICY "Vendors manage slots" ON public.meeting_slots AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = meeting_slots.booth_id) AND (is_event_admin(vb.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = vb.event_id) AND (em.user_id = (select auth.uid())) AND ((em.role = 'vendor'::text) OR ((em.roles IS NOT NULL) AND ('vendor'::text = ANY (em.roles))))))))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = meeting_slots.booth_id) AND (is_event_admin(vb.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = vb.event_id) AND (em.user_id = (select auth.uid())) AND ((em.role = 'vendor'::text) OR ((em.roles IS NOT NULL) AND ('vendor'::text = ANY (em.roles))))))))))));

-- messages | INSERT | Users can send messages
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) = sender_id) AND (NOT users_have_block(sender_id, receiver_id))));

-- messages | SELECT | Users can view own messages
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
CREATE POLICY "Users can view own messages" ON public.messages AS PERMISSIVE FOR SELECT TO public
  USING ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id)));

-- messages | UPDATE | Receiver can mark as read
DROP POLICY IF EXISTS "Receiver can mark as read" ON public.messages;
CREATE POLICY "Receiver can mark as read" ON public.messages AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = receiver_id));

-- notifications | DELETE | Users can delete own notifications
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- notifications | SELECT | Users see own notifications
DROP POLICY IF EXISTS "Users see own notifications" ON public.notifications;
CREATE POLICY "Users see own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- notifications | UPDATE | Users can mark as read
DROP POLICY IF EXISTS "Users can mark as read" ON public.notifications;
CREATE POLICY "Users can mark as read" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

-- platform_audit_log | INSERT | platform_audit_log_platform_admin_insert
DROP POLICY IF EXISTS "platform_audit_log_platform_admin_insert" ON public.platform_audit_log;
CREATE POLICY "platform_audit_log_platform_admin_insert" ON public.platform_audit_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin((select auth.uid())));

-- platform_audit_log | SELECT | platform_audit_log_platform_admin_select
DROP POLICY IF EXISTS "platform_audit_log_platform_admin_select" ON public.platform_audit_log;
CREATE POLICY "platform_audit_log_platform_admin_select" ON public.platform_audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_admin((select auth.uid())));

-- platform_test_guides | DELETE | Platform admins can delete test guides
DROP POLICY IF EXISTS "Platform admins can delete test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can delete test guides" ON public.platform_test_guides AS PERMISSIVE FOR DELETE TO public
  USING (is_platform_admin((select auth.uid())));

-- platform_test_guides | INSERT | Platform admins can insert test guides
DROP POLICY IF EXISTS "Platform admins can insert test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can insert test guides" ON public.platform_test_guides AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_platform_admin((select auth.uid())));

-- platform_test_guides | SELECT | Platform admins can read test guides
DROP POLICY IF EXISTS "Platform admins can read test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can read test guides" ON public.platform_test_guides AS PERMISSIVE FOR SELECT TO public
  USING (is_platform_admin((select auth.uid())));

-- platform_test_guides | UPDATE | Platform admins can update test guides
DROP POLICY IF EXISTS "Platform admins can update test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can update test guides" ON public.platform_test_guides AS PERMISSIVE FOR UPDATE TO public
  USING (is_platform_admin((select auth.uid())))
  WITH CHECK (is_platform_admin((select auth.uid())));

-- point_log | SELECT | Users see own points
DROP POLICY IF EXISTS "Users see own points" ON public.point_log;
CREATE POLICY "Users see own points" ON public.point_log AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- point_rules | ALL | Admins can manage point rules
DROP POLICY IF EXISTS "Admins can manage point rules" ON public.point_rules;
CREATE POLICY "Admins can manage point rules" ON public.point_rules AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- posts | ALL | Admins can manage posts
DROP POLICY IF EXISTS "Admins can manage posts" ON public.posts;
CREATE POLICY "Admins can manage posts" ON public.posts AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_members
  WHERE ((event_members.user_id = (select auth.uid())) AND (event_members.event_id = posts.event_id) AND (event_members.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));

-- posts | INSERT | Users can create posts
DROP POLICY IF EXISTS "Users can create posts" ON public.posts;
CREATE POLICY "Users can create posts" ON public.posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- posts | UPDATE | Users can update own posts
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
CREATE POLICY "Users can update own posts" ON public.posts AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = user_id));

-- schedule_sessions | ALL | Admins can manage schedule
DROP POLICY IF EXISTS "Admins can manage schedule" ON public.schedule_sessions;
CREATE POLICY "Admins can manage schedule" ON public.schedule_sessions AS PERMISSIVE FOR ALL TO public
  USING (((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = (select auth.uid())) AND (em.event_id = schedule_sessions.event_id) AND ((em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])) OR ((em.roles IS NOT NULL) AND ((em.roles @> ARRAY['admin'::text]) OR (em.roles @> ARRAY['super_admin'::text]))))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.is_platform_admin = true))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = (select auth.uid())) AND (em.event_id = schedule_sessions.event_id) AND ((em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])) OR ((em.roles IS NOT NULL) AND ((em.roles @> ARRAY['admin'::text]) OR (em.roles @> ARRAY['super_admin'::text]))))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u.is_platform_admin = true))))));

-- session_check_ins | SELECT | Session check-ins event admin read
DROP POLICY IF EXISTS "Session check-ins event admin read" ON public.session_check_ins;
CREATE POLICY "Session check-ins event admin read" ON public.session_check_ins AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- session_ratings | INSERT | Event members can insert own session rating
DROP POLICY IF EXISTS "Event members can insert own session rating" ON public.session_ratings;
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = session_ratings.event_id) AND (em.user_id = (select auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM schedule_sessions s
  WHERE ((s.id = session_ratings.session_id) AND (s.ratings_enabled = true))))));

-- session_ratings | SELECT | Event admins can view all session ratings in event
DROP POLICY IF EXISTS "Event admins can view all session ratings in event" ON public.session_ratings;
CREATE POLICY "Event admins can view all session ratings in event" ON public.session_ratings AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin((select auth.uid()))));

-- session_ratings | SELECT | Users can view own session ratings
DROP POLICY IF EXISTS "Users can view own session ratings" ON public.session_ratings;
CREATE POLICY "Users can view own session ratings" ON public.session_ratings AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (select auth.uid())));

-- session_ratings | UPDATE | Users can update own session rating
DROP POLICY IF EXISTS "Users can update own session rating" ON public.session_ratings;
CREATE POLICY "Users can update own session rating" ON public.session_ratings AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM schedule_sessions s
  WHERE ((s.id = session_ratings.session_id) AND (s.ratings_enabled = true))))));

-- user_reports | INSERT | Users can insert own reports
DROP POLICY IF EXISTS "Users can insert own reports" ON public.user_reports;
CREATE POLICY "Users can insert own reports" ON public.user_reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((select auth.uid()) = reporter_id) AND ((event_id IS NULL) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = user_reports.event_id) AND (em.user_id = (select auth.uid()))))))));

-- user_reports | SELECT | Users can view own reports
DROP POLICY IF EXISTS "Users can view own reports" ON public.user_reports;
CREATE POLICY "Users can view own reports" ON public.user_reports AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = reporter_id));

-- user_schedule | DELETE | Users can remove bookmarks
DROP POLICY IF EXISTS "Users can remove bookmarks" ON public.user_schedule;
CREATE POLICY "Users can remove bookmarks" ON public.user_schedule AS PERMISSIVE FOR DELETE TO public
  USING (((select auth.uid()) = user_id));

-- user_schedule | INSERT | Users can bookmark sessions
DROP POLICY IF EXISTS "Users can bookmark sessions" ON public.user_schedule;
CREATE POLICY "Users can bookmark sessions" ON public.user_schedule AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = user_id));

-- user_schedule | SELECT | Users can view own schedule
DROP POLICY IF EXISTS "Users can view own schedule" ON public.user_schedule;
CREATE POLICY "Users can view own schedule" ON public.user_schedule AS PERMISSIVE FOR SELECT TO public
  USING (((select auth.uid()) = user_id));

-- users | INSERT | Users can insert own profile
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((select auth.uid()) = id));

-- users | UPDATE | Users can update own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING (((select auth.uid()) = id));
