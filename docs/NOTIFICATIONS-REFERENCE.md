# All notifications currently set up

Reference for in-app notification types, push triggers, and Edge Functions.

---

## Setup status (quick check)

| Area | Status | Notes |
|------|--------|--------|
| **In-app + push (app-triggered)** | ✅ Implemented | Likes, comments, DMs, connection requests, group invites, schedule changes, “Send now” announcements, **B2B meeting assign/edit/cancel** — all create in-app notification and call `send-announcement-push` for device push. |
| **Edge Function `send-announcement-push`** | ✅ Code complete | Deploy so B2B deep link works: `npx supabase functions deploy send-announcement-push`. |
| **Cron-triggered** | ⚙️ Optional | Scheduled announcements, “session in 5 min”, “B2B meeting in 5 min”, “rate this meeting” nudge require Supabase cron setup (pg_cron, pg_net, vault secrets, then run the `scripts/setup-*-cron.sql` scripts). |
| **Local B2B reminder** | ✅ In app | `lib/meetingReminders.ts` — runs when user opens B2B list/booth (no server needed). |

---

## 1. In-app notification types (`NotificationType`)

Defined in `lib/notifications.ts`. Used for the **notifications** table and in-app list (Profile → Notifications).

| Type | Description | Where created |
|------|-------------|----------------|
| **like** | Someone liked your post | Feed — when user likes a post (`feed/index.tsx`) |
| **comment** | Someone commented on a post | `CommentSheet.tsx` — when user adds a comment |
| **message** | Direct message (DM) | `profile/chat/[userId].tsx` — when user sends a DM |
| **message** | Group chat message | `profile/groups/[groupId].tsx` — when user sends a group message; new group invite uses `createNotificationAndPush`, in-group messages use `createNotification` only (no push per message to avoid spam) |
| **announcement** | Event announcement | Admin: “Send now” in app (`admin-announcement-new.tsx`) or admin web; scheduled announcements via `process-scheduled-announcements` |
| **schedule_change** | Schedule session added/edited/deleted | Admin schedule: add session (`admin-schedule.tsx`), edit/delete session (`admin-schedule-edit.tsx`) — notifies event members who bookmarked affected sessions |
| **connection_request** | Someone requested to connect | `community.tsx` (accept from list) or `profile/user/[userId].tsx` (request from profile) |
| **meeting** | B2B “meeting starting soon” (server push) | Edge Function `notify-b2b-meeting-soon` (writes in-app notification with type `meeting`) |
| **meeting** | B2B meeting assigned / updated / cancelled | Booth screen `app/(tabs)/expo/[boothId].tsx` — when admin assigns, edits (time/attendee), or cancels (single or all); in-app + push, data includes `booth_id` for deep link |
| **points** | Points awarded | (Used by points system; may be created elsewhere) |
| **badge** | Badge / achievement | (Available for future use) |
| **system** | System message | (Available for future use) |

---

## 2. Push notifications (device)

All push goes through Expo Push API. Recipients must have `users.push_token` set (app calls `registerPushToken` when logged in on a real device).

### 2.1 App / Edge Function: `send-announcement-push`

**Triggered by:** App (and optionally admin web) when sending a notification that should also push.

| Trigger | Type | Title/body | Recipients |
|--------|------|------------|------------|
| Like on post | like | e.g. “New like”, “X liked your post” | Post author |
| Comment on post | comment | e.g. “New comment”, “X commented…” | Post author |
| Send DM | message | Sender name, message preview | Other user |
| Connection request | connection_request | “Connection request”, “X wants to connect” | Requested user |
| New group invite | message | “Added to group”, group name | Invited users (`groups/new.tsx`) |
| Schedule change (add/edit/delete session) | schedule_change | “Schedule update”, session title / change text | Event members who bookmarked that session |
| Announcement “Send now” | announcement | Announcement title, content | Event members (or target audience) |
| B2B meeting assigned | meeting | “Meeting assigned”, time + vendor | Assigned attendee |
| B2B meeting updated | meeting | “Meeting updated”, new time + vendor | Attendee after edit |
| B2B meeting cancelled (single or all) | meeting | “Meeting cancelled”, vendor name | Affected attendee(s) |

**Edge Function:** `send-announcement-push` (supports `booth_id` for B2B deep link) (called by app with Bearer token; dedupes `recipient_user_ids` so no duplicate push per user per request).

### 2.2 Scheduled announcements (cron)

**Edge Function:** `process-scheduled-announcements`  
**Schedule:** e.g. every 1 min (via `scripts/setup-scheduled-announcements-cron.sql`).

- Finds announcements where `scheduled_at <= now` and `sent_at` is null.
- Inserts in-app notification (type `announcement`) for each recipient.
- Sends push via Expo to each recipient’s `push_token`.
- Sets `sent_at` so it only runs once per announcement.

### 2.3 Session “starting in 5 min” (cron)

**Edge Function:** `notify-event-starting-soon`  
**Schedule:** e.g. every 2 min (via `scripts/setup-event-starting-soon-cron.sql`).

- Finds schedule sessions starting in ~4–6 minutes.
- For each session, finds users who bookmarked it (`user_schedule`) and haven’t been reminded yet (`session_reminder_sent`).
- Sends push: “Session starting soon”, session title.
- Records in `session_reminder_sent` so each user gets at most one reminder per session.

### 2.4 B2B “meeting in 5 min” (push + in-app, cron)

**Edge Function:** `notify-b2b-meeting-soon` (deploy: `npx supabase functions deploy notify-b2b-meeting-soon`)  
**Schedule:** e.g. every 2 min (via `scripts/setup-b2b-meeting-soon-cron.sql`).

- Finds B2B meeting slots starting in ~4–6 minutes.
- For each slot, finds confirmed attendee(s); skips if already sent (`b2b_meeting_reminder_sent`).
- **Sends push** via Expo: “Meeting starting soon”, vendor name; data includes `boothId` for deep link.
- Creates **in-app notification** (type `meeting`).
- Records in `b2b_meeting_reminder_sent` so each attendee gets one push per meeting.

**Manual run:** `POST` to `https://<project-ref>.supabase.co/functions/v1/notify-b2b-meeting-soon` with header `x-cron-secret: <CRON_SECRET>` (from Dashboard → Edge Functions → Secrets).

### 2.5 B2B “rate this meeting” nudge (cron)

**Edge Function:** `nudge-b2b-meeting-feedback`  
**Schedule:** e.g. every 15 min (via `scripts/setup-nudge-b2b-feedback-cron.sql`).

- Finds meetings that ended 5 min–24 hours ago.
- For each attendee who hasn’t submitted feedback yet and hasn’t been nudged (`b2b_meeting_feedback_nudge_sent`).
- Sends one push: nudge to rate the meeting (deep link to booth).
- Records in `b2b_meeting_feedback_nudge_sent` so each booking is nudged at most once.

### 2.6 Local (in-device) B2B reminder

**Code:** `lib/meetingReminders.ts` — `scheduleMeetingReminders()`.

- When user opens B2B list or booth detail, app schedules **local** notifications for their upcoming meetings: “Meeting with [Vendor] starts in 5 minutes.”
- Uses `expo-notifications`; does not run in Expo Go. One per meeting; rescheduled when list is refreshed.

---

## 3. Edge Functions summary

| Function | Purpose | When it runs |
|----------|---------|----------------|
| **send-announcement-push** | Send push for likes, comments, DMs, connection requests, schedule changes, “Send now” announcements | On demand (app or admin web) |
| **process-scheduled-announcements** | Send due scheduled announcements (in-app + push) | Cron (e.g. every 1 min) |
| **notify-event-starting-soon** | “Session starting in ~5 min” push | Cron (e.g. every 2 min) |
| **notify-b2b-meeting-soon** | “B2B meeting in ~5 min” push + in-app `meeting` | Cron (e.g. every 2 min) |
| **nudge-b2b-meeting-feedback** | “Rate this meeting” push after meeting ended | Cron (e.g. every 15 min) |

---

## 4. Android channel

All push uses channel: **`collectivelive_notifications_v2`** (sound, vibration, badge). Defined in `app/_layout.tsx` and in each Edge Function that sends push.

---

## 5. Deep links (from push tap)

- **Post:** `collectivelive://post/{post_id}` (data: `post_id`)  
- **Chat:** `collectivelive://chat/{chat_user_id}` (data: `chat_user_id`)  
- **Group:** `collectivelive://group/{group_id}` (data: `group_id`)  
- **B2B booth:** `collectivelive://expo/{boothId}` (data: `boothId`)

Handled in `lib/useDeepLink.ts`.
