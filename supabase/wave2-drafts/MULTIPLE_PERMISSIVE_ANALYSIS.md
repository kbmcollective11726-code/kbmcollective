# multiple_permissive_policies groups (>=2 policies for same table/role/action)

## b2b_meeting_feedback
  b2b_meeting_feedback|public|SELECT  =>  2 policies: Event admins can view all B2B feedback in event | Users can view own B2B feedback

## badge_scan_meeting_attendance
  badge_scan_meeting_attendance|public|SELECT  =>  2 policies: BSMA event admin read | BSMA scanner read own

## badge_scans
  badge_scans|public|SELECT  =>  2 policies: Badge scans admin read | Badge scans scanner read own

## chat_group_members
  chat_group_members|public|SELECT  =>  2 policies: Admins can manage chat group members | Members can view chat group members
  chat_group_members|public|INSERT  =>  2 policies: Admins can manage chat group members | Creators can add themselves to chat group members

## chat_groups
  chat_groups|public|SELECT  =>  2 policies: Event members and creator can view chat groups in event | View chat groups: member or event admin or creator

## event_matchmaking_settings
  event_matchmaking_settings|public|SELECT  =>  2 policies: Event admins manage matchmaking settings | Public read open matchmaking settings

## event_meeting_interest_requests
  event_meeting_interest_requests|public|SELECT  =>  2 policies: Members manage meeting interest requests in own submissions | Members read meeting interest requests in own submissions
  event_meeting_interest_requests|public|INSERT  =>  2 policies: Members manage meeting interest requests in own submissions | Public insert meeting interests for open registration submissio

## event_members
  event_members|public|SELECT  =>  3 policies: Admins can manage members | Platform admins can manage event members | Members can view event members
  event_members|public|INSERT  =>  3 policies: Admins can manage members | Platform admins can manage event members | Users can join events
  event_members|public|UPDATE  =>  3 policies: Admins can manage members | Platform admins can manage event members | Users can update own role
  event_members|public|DELETE  =>  2 policies: Admins can manage members | Platform admins can manage event members

## event_registration_answers
  event_registration_answers|public|SELECT  =>  2 policies: Members manage answers in own submissions | Members read answers in own submissions
  event_registration_answers|public|INSERT  =>  2 policies: Members manage answers in own submissions | Public insert answers for open registration submissions

## event_registration_forms
  event_registration_forms|public|SELECT  =>  3 policies: Event admins manage registration forms | Event members can view registration forms | Public read open registration forms

## event_registration_question_options
  event_registration_question_options|public|SELECT  =>  3 policies: Event admins manage question options | Event members can view question options | Public read open registration options

## event_registration_questions
  event_registration_questions|public|SELECT  =>  3 policies: Event admins manage registration questions | Event members can view registration questions | Public read open registration questions

## event_registration_submissions
  event_registration_submissions|public|INSERT  =>  2 policies: Members can create own submissions | Public insert submissions when registration open

## event_sponsors
  event_sponsors|public|SELECT  =>  3 policies: Event admins manage event sponsors | Event members can view event sponsors | Public read live wall sponsors

## events
  events|public|SELECT  =>  2 policies: Admins can manage events | Events are viewable by everyone
  events|public|INSERT  =>  2 policies: Admins can manage events | Authenticated users can create events
  events|public|UPDATE  =>  2 policies: Admins can manage events | Admins can update events
  events|public|DELETE  =>  2 policies: Admins can manage events | Super admins can delete events

## meeting_bookings
  meeting_bookings|public|SELECT  =>  3 policies: Booth reps and event admins can view booth bookings | Platform admins can view meeting bookings | Users see own bookings

## meeting_slots
  meeting_slots|public|SELECT  =>  3 policies: Platform admins manage slots | Vendors manage slots | Slots viewable
  meeting_slots|public|INSERT  =>  2 policies: Platform admins manage slots | Vendors manage slots
  meeting_slots|public|UPDATE  =>  2 policies: Platform admins manage slots | Vendors manage slots
  meeting_slots|public|DELETE  =>  2 policies: Platform admins manage slots | Vendors manage slots

## point_rules
  point_rules|public|SELECT  =>  2 policies: Admins can manage point rules | Point rules viewable

## posts
  posts|public|SELECT  =>  2 policies: Admins can manage posts | Posts are viewable by everyone
  posts|public|INSERT  =>  2 policies: Admins can manage posts | Users can create posts
  posts|public|UPDATE  =>  2 policies: Admins can manage posts | Users can update own posts

## schedule_sessions
  schedule_sessions|public|SELECT  =>  2 policies: Admins can manage schedule | Schedule is viewable

## session_ratings
  session_ratings|public|SELECT  =>  2 policies: Event admins can view all session ratings in event | Users can view own session ratings

## users
  users|authenticated|UPDATE  =>  2 policies: Event admins can update event member profiles | Platform admins can update any user profile

## vendor_booth_reps
  vendor_booth_reps|public|SELECT  =>  2 policies: Admins manage vendor booth reps | Vendor booth reps viewable

## vendor_booths
  vendor_booths|public|SELECT  =>  2 policies: Admins manage booths | Vendor booths viewable
