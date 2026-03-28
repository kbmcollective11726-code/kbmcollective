# Complete system check report

Generated from database queries (Supabase MCP), codebase scan, and config review.

---

## 1. Database

### Tables (27 in `public`)

| Table | Purpose |
|-------|--------|
| announcements | Scheduled / sent announcements |
| b2b_meeting_reminder_sent | B2B “meeting in 5 min” push sent tracking |
| blocked_users | User blocks |
| chat_group_event | Links chat groups to events |
| chat_group_members | Group membership |
| chat_groups | Private chat groups (admin-created) |
| comments | Post comments |
| connection_requests | Pending connection requests |
| connections | Accepted connections |
| event_members | Event membership + roles |
| events | Events |
| group_messages | Group chat messages |
| likes | Post likes |
| meeting_bookings | B2B meeting bookings |
| meeting_slots | B2B slots per booth |
| messages | DMs (with attachment_url, attachment_type) |
| notifications | In-app notifications (type, user_id, event_id, data) |
| point_log | Points history |
| point_rules | Point rules per event |
| posts | Feed posts (is_deleted for soft delete) |
| schedule_sessions | Agenda sessions |
| session_ratings | Session ratings 1–5 + comment |
| session_reminder_sent | “Session in 5 min” push sent tracking |
| user_reports | User reports |
| user_schedule | User session bookmarks |
| users | Profiles (push_token, is_platform_admin) |
| vendor_booths | B2B booths (banner_url) |

**Status:** All expected tables present.

### Key columns verified

- `users`: push_token, is_platform_admin  
- `events`: contact_phone, created_by  
- `messages`: attachment_url, attachment_type  
- `vendor_booths`: banner_url  
- `notifications`: type  
- `posts`: is_deleted  

### Functions (19 in `public`)

- add_creator_as_event_admin  
- can_manage_chat_group_members  
- carry_connections_on_join_event  
- create_event_request  
- delete_own_post  
- generate_event_code / generate_event_code_for_backfill  
- get_chat_group_member_count  
- get_session_rating_stats  
- handle_new_user  
- is_event_admin / is_platform_admin  
- is_member_of_chat_group  
- remove_points_on_unlike  
- sync_chat_group_event  
- sync_event_member_primary_role  
- update_comments_count / update_likes_count  
- update_member_points  
- update_updated_at  

**Status:** All expected helpers and RPCs present.

### RLS

- **Policies:** 76 policies across 22 tables.  
- **Critical:** posts (4), notifications (4), meeting_bookings (6), chat_groups (6), group_messages (2), session_ratings (4), event_members (5), events (5).  
- **b2b_meeting_reminder_sent:** RLS off (intended; only Edge Function writes).  
- **session_reminder_sent:** RLS on with service-role policy.  

**Status:** RLS in place for app and cron use.

### Triggers (public)

- chat_groups: sync_chat_group_event_trigger (INSERT, UPDATE)  
- comments: on_comment_change (INSERT, DELETE)  
- event_members: carry_connections_on_join_event (INSERT), sync_primary_role (INSERT, UPDATE)  
- events: add_creator_as_admin_after_insert (INSERT), set_event_code_on_insert (INSERT), update_events_updated_at (UPDATE)  
- likes: on_like_change (INSERT, DELETE), on_like_deleted_remove_points (DELETE)  
- point_log: on_points_earned (INSERT)  
- users: update_users_updated_at (UPDATE)  

**Note:** `handle_new_user` is in `public`; trigger on `auth.users` is typically in Supabase schema (not in this list). Ensure “Create user profile on signup” is set up in Dashboard if you use it.

---

## 2. Edge Functions (11 in repo)

| Function | Purpose | Cron |
|----------|---------|------|
| send-announcement-push | Send push to users (likes, comments, announcements) | No |
| notify-event-starting-soon | “Session in 5 min” push | Every 2 min (script) |
| notify-b2b-meeting-soon | “B2B meeting in 5 min” push | Every 2 min (script) |
| nudge-b2b-meeting-feedback | Nudge to rate B2B meeting | Every ~15 min (script) |
| process-scheduled-announcements | Send due scheduled announcements | Every 1 min (script) |
| auto-deactivate-events | Deactivate old events | Daily (script) |
| get-r2-upload-url | R2 upload URL (verify_jwt = false) | No |
| upload-image-to-r2 | Upload image to R2 (verify_jwt = false) | No |
| delete-user | Delete user account (platform admin) | No |
| set-event-creator-admin | Set event creator as admin | No |
| bulk-create-users | Admin bulk invite (`admin-setup` / Members) | No |

**Deploy:** `npm run supabase:deploy-functions` (all of the above).  
**Cron:** Run each `scripts/setup-*-cron.sql` in SQL Editor, then **`scripts/verify-cron-jobs.sql`** — many projects only have `auto-deactivate-events` until the other scripts are applied. See **docs/SUPABASE-LIVE-AUDIT.md**.

**Note:** Dashboard may list extra functions (e.g. `create-event-request`) not present in this repo.

---

## 3. App

### Config

- **app.json:** KBM Connect, slug kbmconnect, scheme collectivelive, EAS projectId set, iOS/Android package IDs, expo-notifications and permissions configured.  
- **eas.json:** preview/production env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for project noydhokbswedvltjyenr.  
- **.env:** Use .env.example; set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (and optionally EXPO_PUBLIC_LIVE_WALL_URL, EXPO_PUBLIC_ANDROID_USE_R2).  

### Auth flow

- **app/index.tsx:** Redirects authenticated → platform admin to admin-all-events, else (tabs)/home; unauthenticated → (auth)/login. Safety timeout to login.  
- **lib/supabase.ts:** Reads URL/anon key from Constants.expoConfig.extra or env; placeholder if missing so app loads.  

### Navigation & back behavior

- Back buttons use `from` param where applicable: notifications, profile edit, admin, admin-schedule, chat, expo booth.  
- HeaderNotificationBell and AnnouncementBanner pass `from` to notifications.  
- Deep links: post, chat, group, expo (booth), meeting_reminder (boothId).  

### Notifications (in-app + push)

- **lib/notifications.ts:** createNotification, createNotificationAndPush; types: like, comment, message, announcement, points, badge, meeting, schedule_change, connection_request, system.  
- **lib/pushNotifications.ts:** registerPushToken, sendPushToUser, sendAnnouncementPush (calls Edge Function).  
- **App:** NOTIFICATION_CHANNEL_ID = collectivelive_notifications_v2; Android channel set for sound/vibration.  
- **B2B reminder:** Local reminders in lib/meetingReminders.ts; server push via notify-b2b-meeting-soon (table b2b_meeting_reminder_sent created).  

### Dependencies (package.json)

- Expo ~54, React 19, react-native 0.81, @supabase/supabase-js, expo-router, expo-notifications, zustand, date-fns, lucide-react-native, etc.  
- No critical missing deps detected.  

---

## 4. Scripts and cron

- **Cron SQL:** setup-scheduled-announcements-cron.sql, setup-event-starting-soon-cron.sql, setup-b2b-meeting-soon-cron.sql, setup-auto-deactivate-events-cron.sql.  
- **Session reminder table:** setup-session-reminder-5min.sql (session_reminder_sent).  
- **Other:** Migrations applied via MCP; one-off fixes and seeds in scripts/.  

**To run crons:** Enable pg_cron and pg_net, store project_url and cron_secret in Vault, then run each setup-*-cron.sql.

---

## 5. Summary checklist

| Area | Status |
|------|--------|
| Database tables | OK – 27 tables |
| Database functions | OK – 19 functions |
| RLS policies | OK – 76 policies |
| Triggers | OK – core triggers present |
| Key columns (users, events, messages, etc.) | OK |
| b2b_meeting_reminder_sent | OK – table exists, RLS off |
| Edge Functions (repo) | OK – 9 functions |
| App config (app.json, eas.json) | OK |
| Env / Supabase URL | OK – .env.example and eas env set |
| Auth redirect (index) | OK |
| Back navigation / from param | OK |
| Deep links (post, chat, group, expo, meeting) | OK |
| Notifications (create + push) | OK |
| Cron scripts | Present – run in SQL Editor if not yet run |

---

## 6. Optional / follow-up

1. **Cron jobs:** If reminders and scheduled announcements are not firing, run the four `scripts/setup-*-cron.sql` scripts and set CRON_SECRET on the relevant Edge Functions.  
2. **Auth trigger:** Confirm in Supabase Dashboard (Database → Triggers or Auth hooks) that new signups create a row in `public.users` (handle_new_user).  
3. **.env:** Ensure local .env has EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for development.  
4. **R2:** If using image upload to R2, set EXPO_PUBLIC_ANDROID_USE_R2 and configure R2 + Edge Function secrets.

---

*End of system check.*
