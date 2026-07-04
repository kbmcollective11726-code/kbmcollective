-- ROLLBACK for Wave 2b: drop merged policies and restore originals.

-- ===== b2b_meeting_feedback  [roles: public] =====
DROP POLICY IF EXISTS "b2b_meeting_feedback_select_perm" ON public.b2b_meeting_feedback;
DROP POLICY IF EXISTS "b2b_meeting_feedback_insert_perm" ON public.b2b_meeting_feedback;
DROP POLICY IF EXISTS "b2b_meeting_feedback_update_perm" ON public.b2b_meeting_feedback;
CREATE POLICY "Attendee can insert own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM meeting_bookings mb
  WHERE ((mb.id = b2b_meeting_feedback.booking_id) AND (mb.attendee_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Event admins can view all B2B feedback in event" ON public.b2b_meeting_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ((meeting_bookings mb
     JOIN meeting_slots ms ON ((ms.id = mb.slot_id)))
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((mb.id = b2b_meeting_feedback.booking_id) AND (is_event_admin(vb.event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Users can view own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Attendee can update own B2B feedback" ON public.b2b_meeting_feedback AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- ===== badge_scan_meeting_attendance  [roles: public] =====
DROP POLICY IF EXISTS "badge_scan_meeting_attendance_select_perm" ON public.badge_scan_meeting_attendance;
CREATE POLICY "BSMA event admin read" ON public.badge_scan_meeting_attendance AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "BSMA scanner read own" ON public.badge_scan_meeting_attendance AS PERMISSIVE FOR SELECT TO public
  USING ((scanner_user_id = ( SELECT auth.uid() AS uid)));

-- ===== badge_scans  [roles: public] =====
DROP POLICY IF EXISTS "badge_scans_select_perm" ON public.badge_scans;
CREATE POLICY "Badge scans admin read" ON public.badge_scans AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Badge scans scanner read own" ON public.badge_scans AS PERMISSIVE FOR SELECT TO public
  USING ((scanner_user_id = ( SELECT auth.uid() AS uid)));

-- ===== chat_group_members  [roles: public] =====
DROP POLICY IF EXISTS "chat_group_members_select_perm" ON public.chat_group_members;
DROP POLICY IF EXISTS "chat_group_members_insert_perm" ON public.chat_group_members;
DROP POLICY IF EXISTS "chat_group_members_update_perm" ON public.chat_group_members;
DROP POLICY IF EXISTS "chat_group_members_delete_perm" ON public.chat_group_members;
CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members AS PERMISSIVE FOR ALL TO public
  USING (can_manage_chat_group_members(group_id))
  WITH CHECK (can_manage_chat_group_members(group_id));
CREATE POLICY "Creators can add themselves to chat group members" ON public.chat_group_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM chat_groups g
  WHERE ((g.id = chat_group_members.group_id) AND (g.created_by = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Members can view chat group members" ON public.chat_group_members AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (can_manage_chat_group_members(group_id) OR is_member_of_chat_group(group_id, ( SELECT auth.uid() AS uid)))));

-- ===== chat_groups  [roles: public] =====
DROP POLICY IF EXISTS "chat_groups_select_perm" ON public.chat_groups;
DROP POLICY IF EXISTS "chat_groups_insert_perm" ON public.chat_groups;
DROP POLICY IF EXISTS "chat_groups_update_perm" ON public.chat_groups;
DROP POLICY IF EXISTS "chat_groups_delete_perm" ON public.chat_groups;
CREATE POLICY "Admins can delete chat groups" ON public.chat_groups AS PERMISSIVE FOR DELETE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Admins can create chat groups" ON public.chat_groups AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Event members and creator can view chat groups in event" ON public.chat_groups AS PERMISSIVE FOR SELECT TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = chat_groups.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "View chat groups: member or event admin or creator" ON public.chat_groups AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((created_by = ( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = chat_groups.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid))))) OR is_member_of_chat_group(id, ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Admins can update chat groups" ON public.chat_groups AS PERMISSIVE FOR UPDATE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));

-- ===== event_matchmaking_settings  [roles: public] =====
DROP POLICY IF EXISTS "event_matchmaking_settings_select_perm" ON public.event_matchmaking_settings;
DROP POLICY IF EXISTS "event_matchmaking_settings_insert_perm" ON public.event_matchmaking_settings;
DROP POLICY IF EXISTS "event_matchmaking_settings_update_perm" ON public.event_matchmaking_settings;
DROP POLICY IF EXISTS "event_matchmaking_settings_delete_perm" ON public.event_matchmaking_settings;
CREATE POLICY "Event admins manage matchmaking settings" ON public.event_matchmaking_settings AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Public read open matchmaking settings" ON public.event_matchmaking_settings AS PERMISSIVE FOR SELECT TO public
  USING (((registration_open = true) OR is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)) OR has_submitted_delegate_registration(event_id)));

-- ===== event_meeting_interest_requests  [roles: public] =====
DROP POLICY IF EXISTS "event_meeting_interest_requests_select_perm" ON public.event_meeting_interest_requests;
DROP POLICY IF EXISTS "event_meeting_interest_requests_insert_perm" ON public.event_meeting_interest_requests;
DROP POLICY IF EXISTS "event_meeting_interest_requests_update_perm" ON public.event_meeting_interest_requests;
DROP POLICY IF EXISTS "event_meeting_interest_requests_delete_perm" ON public.event_meeting_interest_requests;
CREATE POLICY "Members manage meeting interest requests in own submissions" ON public.event_meeting_interest_requests AS PERMISSIVE FOR ALL TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (is_event_meeting_requests_open(event_id) AND (EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND ((s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))))))
  WITH CHECK ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (is_event_meeting_requests_open(event_id) AND (EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND ((s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))))));
CREATE POLICY "Public insert meeting interests for open registration submissio" ON public.event_meeting_interest_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_public_registration_submission(submission_id));
CREATE POLICY "Members read meeting interest requests in own submissions" ON public.event_meeting_interest_requests AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_meeting_interest_requests.submission_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(s.event_id) OR (s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))));

-- ===== event_members  [roles: public] =====
DROP POLICY IF EXISTS "event_members_select_perm" ON public.event_members;
DROP POLICY IF EXISTS "event_members_insert_perm" ON public.event_members;
DROP POLICY IF EXISTS "event_members_update_perm" ON public.event_members;
DROP POLICY IF EXISTS "event_members_delete_perm" ON public.event_members;
CREATE POLICY "Admins can manage members" ON public.event_members AS PERMISSIVE FOR ALL TO public
  USING (is_event_admin(event_id))
  WITH CHECK (is_event_admin(event_id));
CREATE POLICY "Platform admins can manage event members" ON public.event_members AS PERMISSIVE FOR ALL TO public
  USING (is_platform_admin(( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can join events" ON public.event_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Members can view event members" ON public.event_members AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Users can update own role" ON public.event_members AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (role = ANY (ARRAY['attendee'::text, 'speaker'::text, 'vendor'::text]))));

-- ===== event_registration_answers  [roles: public] =====
DROP POLICY IF EXISTS "event_registration_answers_select_perm" ON public.event_registration_answers;
DROP POLICY IF EXISTS "event_registration_answers_insert_perm" ON public.event_registration_answers;
DROP POLICY IF EXISTS "event_registration_answers_update_perm" ON public.event_registration_answers;
DROP POLICY IF EXISTS "event_registration_answers_delete_perm" ON public.event_registration_answers;
CREATE POLICY "Members manage answers in own submissions" ON public.event_registration_answers AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(s.event_id) OR (s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(s.event_id) OR (s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))));
CREATE POLICY "Public insert answers for open registration submissions" ON public.event_registration_answers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_public_registration_submission(submission_id));
CREATE POLICY "Members read answers in own submissions" ON public.event_registration_answers AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_submissions s
  WHERE ((s.id = event_registration_answers.submission_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(s.event_id) OR (s.user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(s.id))))));

-- ===== event_registration_forms  [roles: public] =====
DROP POLICY IF EXISTS "event_registration_forms_select_perm" ON public.event_registration_forms;
DROP POLICY IF EXISTS "event_registration_forms_insert_perm" ON public.event_registration_forms;
DROP POLICY IF EXISTS "event_registration_forms_update_perm" ON public.event_registration_forms;
DROP POLICY IF EXISTS "event_registration_forms_delete_perm" ON public.event_registration_forms;
CREATE POLICY "Event admins manage registration forms" ON public.event_registration_forms AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Event members can view registration forms" ON public.event_registration_forms AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = event_registration_forms.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Public read open registration forms" ON public.event_registration_forms AS PERMISSIVE FOR SELECT TO public
  USING (((is_active = true) AND (EXISTS ( SELECT 1
   FROM event_matchmaking_settings s
  WHERE ((s.event_id = event_registration_forms.event_id) AND (s.registration_open = true))))));

-- ===== event_registration_question_options  [roles: public] =====
DROP POLICY IF EXISTS "event_registration_question_options_select_perm" ON public.event_registration_question_options;
DROP POLICY IF EXISTS "event_registration_question_options_insert_perm" ON public.event_registration_question_options;
DROP POLICY IF EXISTS "event_registration_question_options_update_perm" ON public.event_registration_question_options;
DROP POLICY IF EXISTS "event_registration_question_options_delete_perm" ON public.event_registration_question_options;
CREATE POLICY "Event admins manage question options" ON public.event_registration_question_options AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_event_admin(f.event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_event_admin(f.event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Event members can view question options" ON public.event_registration_question_options AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(f.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = f.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid))))))))));
CREATE POLICY "Public read open registration options" ON public.event_registration_question_options AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ((event_registration_questions q
     JOIN event_registration_forms f ON ((f.id = q.form_id)))
     JOIN event_matchmaking_settings s ON ((s.event_id = f.event_id)))
  WHERE ((q.id = event_registration_question_options.question_id) AND (f.is_active = true) AND (s.registration_open = true)))));

-- ===== event_registration_questions  [roles: public] =====
DROP POLICY IF EXISTS "event_registration_questions_select_perm" ON public.event_registration_questions;
DROP POLICY IF EXISTS "event_registration_questions_insert_perm" ON public.event_registration_questions;
DROP POLICY IF EXISTS "event_registration_questions_update_perm" ON public.event_registration_questions;
DROP POLICY IF EXISTS "event_registration_questions_delete_perm" ON public.event_registration_questions;
CREATE POLICY "Event admins manage registration questions" ON public.event_registration_questions AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_event_admin(f.event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_event_admin(f.event_id) OR is_platform_admin(( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Event members can view registration questions" ON public.event_registration_questions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM event_registration_forms f
  WHERE ((f.id = event_registration_questions.form_id) AND (is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(f.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = f.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid))))))))));
CREATE POLICY "Public read open registration questions" ON public.event_registration_questions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (event_registration_forms f
     JOIN event_matchmaking_settings s ON ((s.event_id = f.event_id)))
  WHERE ((f.id = event_registration_questions.form_id) AND (f.is_active = true) AND (s.registration_open = true)))));

-- ===== event_registration_submissions  [roles: public] =====
DROP POLICY IF EXISTS "event_registration_submissions_select_perm" ON public.event_registration_submissions;
DROP POLICY IF EXISTS "event_registration_submissions_insert_perm" ON public.event_registration_submissions;
DROP POLICY IF EXISTS "event_registration_submissions_update_perm" ON public.event_registration_submissions;
DROP POLICY IF EXISTS "event_registration_submissions_delete_perm" ON public.event_registration_submissions;
CREATE POLICY "Event admins delete submissions" ON public.event_registration_submissions AS PERMISSIVE FOR DELETE TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Members can create own submissions" ON public.event_registration_submissions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (user_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY "Public insert submissions when registration open" ON public.event_registration_submissions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id IS NULL) AND is_event_registration_open(event_id)));
CREATE POLICY "Members read submissions in their events" ON public.event_registration_submissions AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(id)));
CREATE POLICY "Members update own submissions" ON public.event_registration_submissions AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(id)))
  WITH CHECK ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR registration_submission_owned_by_auth(id)));

-- ===== event_sponsors  [roles: public] =====
DROP POLICY IF EXISTS "event_sponsors_select_perm" ON public.event_sponsors;
DROP POLICY IF EXISTS "event_sponsors_insert_perm" ON public.event_sponsors;
DROP POLICY IF EXISTS "event_sponsors_update_perm" ON public.event_sponsors;
DROP POLICY IF EXISTS "event_sponsors_delete_perm" ON public.event_sponsors;
CREATE POLICY "Event admins manage event sponsors" ON public.event_sponsors AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Event members can view event sponsors" ON public.event_sponsors AS PERMISSIVE FOR SELECT TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR is_event_admin(event_id) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = event_sponsors.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Public read live wall sponsors" ON public.event_sponsors AS PERMISSIVE FOR SELECT TO public
  USING (((is_active = true) AND (show_on_live_wall = true) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_sponsors.event_id) AND (e.is_active = true))))));

-- ===== events  [roles: public] =====
DROP POLICY IF EXISTS "events_select_perm" ON public.events;
DROP POLICY IF EXISTS "events_insert_perm" ON public.events;
DROP POLICY IF EXISTS "events_update_perm" ON public.events;
DROP POLICY IF EXISTS "events_delete_perm" ON public.events;
CREATE POLICY "Admins can manage events" ON public.events AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_members
  WHERE ((event_members.user_id = ( SELECT auth.uid() AS uid)) AND (event_members.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
CREATE POLICY "Super admins can delete events" ON public.events AS PERMISSIVE FOR DELETE TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = ( SELECT auth.uid() AS uid)) AND ((em.role = 'super_admin'::text) OR ('super_admin'::text = ANY (COALESCE(em.roles, ARRAY[]::text[])))))))));
CREATE POLICY "Authenticated users can create events" ON public.events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY "Events are viewable by everyone" ON public.events AS PERMISSIVE FOR SELECT TO public
  USING (((is_active = true) OR is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "Admins can update events" ON public.events AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = events.id) AND (em.user_id = ( SELECT auth.uid() AS uid)) AND (em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))));

-- ===== meeting_bookings  [roles: public] =====
DROP POLICY IF EXISTS "meeting_bookings_select_perm" ON public.meeting_bookings;
DROP POLICY IF EXISTS "meeting_bookings_insert_perm" ON public.meeting_bookings;
DROP POLICY IF EXISTS "meeting_bookings_update_perm" ON public.meeting_bookings;
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))));
CREATE POLICY "Booth reps and event admins can view booth bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND (is_event_admin(vb.event_id) OR (vb.contact_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM vendor_booth_reps vbr
          WHERE ((vbr.booth_id = vb.id) AND (vbr.user_id = ( SELECT auth.uid() AS uid))))))))));
CREATE POLICY "Platform admins can view meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING (is_platform_admin(( SELECT auth.uid() AS uid)));
CREATE POLICY "Users see own bookings" ON public.meeting_bookings AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT auth.uid() AS uid) = attendee_id));
CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings AS PERMISSIVE FOR UPDATE TO public
  USING ((is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))))
  WITH CHECK ((is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (meeting_slots ms
     JOIN vendor_booths vb ON ((vb.id = ms.booth_id)))
  WHERE ((ms.id = meeting_bookings.slot_id) AND is_event_admin(vb.event_id))))));

-- ===== meeting_slots  [roles: public] =====
DROP POLICY IF EXISTS "meeting_slots_select_perm" ON public.meeting_slots;
DROP POLICY IF EXISTS "meeting_slots_insert_perm" ON public.meeting_slots;
DROP POLICY IF EXISTS "meeting_slots_update_perm" ON public.meeting_slots;
DROP POLICY IF EXISTS "meeting_slots_delete_perm" ON public.meeting_slots;
CREATE POLICY "Platform admins manage slots" ON public.meeting_slots AS PERMISSIVE FOR ALL TO public
  USING (is_platform_admin(( SELECT auth.uid() AS uid)))
  WITH CHECK (is_platform_admin(( SELECT auth.uid() AS uid)));
CREATE POLICY "Vendors manage slots" ON public.meeting_slots AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = meeting_slots.booth_id) AND (is_event_admin(vb.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = vb.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid)) AND ((em.role = 'vendor'::text) OR ((em.roles IS NOT NULL) AND ('vendor'::text = ANY (em.roles))))))))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = meeting_slots.booth_id) AND (is_event_admin(vb.event_id) OR (EXISTS ( SELECT 1
           FROM event_members em
          WHERE ((em.event_id = vb.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid)) AND ((em.role = 'vendor'::text) OR ((em.roles IS NOT NULL) AND ('vendor'::text = ANY (em.roles))))))))))));
CREATE POLICY "Slots viewable" ON public.meeting_slots AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- ===== point_rules  [roles: public] =====
DROP POLICY IF EXISTS "point_rules_select_perm" ON public.point_rules;
DROP POLICY IF EXISTS "point_rules_insert_perm" ON public.point_rules;
DROP POLICY IF EXISTS "point_rules_update_perm" ON public.point_rules;
DROP POLICY IF EXISTS "point_rules_delete_perm" ON public.point_rules;
CREATE POLICY "Admins can manage point rules" ON public.point_rules AS PERMISSIVE FOR ALL TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Point rules viewable" ON public.point_rules AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- ===== posts  [roles: public] =====
DROP POLICY IF EXISTS "posts_select_perm" ON public.posts;
DROP POLICY IF EXISTS "posts_insert_perm" ON public.posts;
DROP POLICY IF EXISTS "posts_update_perm" ON public.posts;
DROP POLICY IF EXISTS "posts_delete_perm" ON public.posts;
CREATE POLICY "Admins can manage posts" ON public.posts AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM event_members
  WHERE ((event_members.user_id = ( SELECT auth.uid() AS uid)) AND (event_members.event_id = posts.event_id) AND (event_members.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
CREATE POLICY "Users can create posts" ON public.posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Posts are viewable by everyone" ON public.posts AS PERMISSIVE FOR SELECT TO public
  USING ((is_deleted = false));
CREATE POLICY "Users can update own posts" ON public.posts AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id));

-- ===== schedule_sessions  [roles: public] =====
DROP POLICY IF EXISTS "schedule_sessions_select_perm" ON public.schedule_sessions;
DROP POLICY IF EXISTS "schedule_sessions_insert_perm" ON public.schedule_sessions;
DROP POLICY IF EXISTS "schedule_sessions_update_perm" ON public.schedule_sessions;
DROP POLICY IF EXISTS "schedule_sessions_delete_perm" ON public.schedule_sessions;
CREATE POLICY "Admins can manage schedule" ON public.schedule_sessions AS PERMISSIVE FOR ALL TO public
  USING (((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = ( SELECT auth.uid() AS uid)) AND (em.event_id = schedule_sessions.event_id) AND ((em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])) OR ((em.roles IS NOT NULL) AND ((em.roles @> ARRAY['admin'::text]) OR (em.roles @> ARRAY['super_admin'::text]))))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.is_platform_admin = true))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = ( SELECT auth.uid() AS uid)) AND (em.event_id = schedule_sessions.event_id) AND ((em.role = ANY (ARRAY['admin'::text, 'super_admin'::text])) OR ((em.roles IS NOT NULL) AND ((em.roles @> ARRAY['admin'::text]) OR (em.roles @> ARRAY['super_admin'::text]))))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.is_platform_admin = true))))));
CREATE POLICY "Schedule is viewable" ON public.schedule_sessions AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- ===== session_ratings  [roles: public] =====
DROP POLICY IF EXISTS "session_ratings_select_perm" ON public.session_ratings;
DROP POLICY IF EXISTS "session_ratings_insert_perm" ON public.session_ratings;
DROP POLICY IF EXISTS "session_ratings_update_perm" ON public.session_ratings;
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.event_id = session_ratings.event_id) AND (em.user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM schedule_sessions s
  WHERE ((s.id = session_ratings.session_id) AND (s.ratings_enabled = true))))));
CREATE POLICY "Event admins can view all session ratings in event" ON public.session_ratings AS PERMISSIVE FOR SELECT TO public
  USING ((is_event_admin(event_id) OR is_platform_admin(( SELECT auth.uid() AS uid))));
CREATE POLICY "Users can view own session ratings" ON public.session_ratings AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Users can update own session rating" ON public.session_ratings AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM schedule_sessions s
  WHERE ((s.id = session_ratings.session_id) AND (s.ratings_enabled = true))))));

-- ===== users  [roles: authenticated] =====
DROP POLICY IF EXISTS "users_update_perm" ON public.users;
CREATE POLICY "Event admins can update event member profiles" ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = users.id) AND is_event_admin(em.event_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM event_members em
  WHERE ((em.user_id = users.id) AND is_event_admin(em.event_id)))));
CREATE POLICY "Platform admins can update any user profile" ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ===== vendor_booth_reps  [roles: public] =====
DROP POLICY IF EXISTS "vendor_booth_reps_select_perm" ON public.vendor_booth_reps;
DROP POLICY IF EXISTS "vendor_booth_reps_insert_perm" ON public.vendor_booth_reps;
DROP POLICY IF EXISTS "vendor_booth_reps_update_perm" ON public.vendor_booth_reps;
DROP POLICY IF EXISTS "vendor_booth_reps_delete_perm" ON public.vendor_booth_reps;
CREATE POLICY "Admins manage vendor booth reps" ON public.vendor_booth_reps AS PERMISSIVE FOR ALL TO public
  USING ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = vendor_booth_reps.booth_id) AND is_event_admin(vb.event_id))))))
  WITH CHECK ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM vendor_booths vb
  WHERE ((vb.id = vendor_booth_reps.booth_id) AND is_event_admin(vb.event_id))))));
CREATE POLICY "Vendor booth reps viewable" ON public.vendor_booth_reps AS PERMISSIVE FOR SELECT TO public
  USING (true);

-- ===== vendor_booths  [roles: public] =====
DROP POLICY IF EXISTS "vendor_booths_select_perm" ON public.vendor_booths;
DROP POLICY IF EXISTS "vendor_booths_insert_perm" ON public.vendor_booths;
DROP POLICY IF EXISTS "vendor_booths_update_perm" ON public.vendor_booths;
DROP POLICY IF EXISTS "vendor_booths_delete_perm" ON public.vendor_booths;
CREATE POLICY "Admins manage booths" ON public.vendor_booths AS PERMISSIVE FOR ALL TO public
  USING ((is_platform_admin() OR is_event_admin(event_id)))
  WITH CHECK ((is_platform_admin() OR is_event_admin(event_id)));
CREATE POLICY "Vendor booths viewable" ON public.vendor_booths AS PERMISSIVE FOR SELECT TO public
  USING (true);
