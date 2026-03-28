# Supabase live audit (project checklist)

Use this to confirm **database**, **Edge Functions**, and **cron** match what the Expo app and `admin-setup` expect.

**One-shot SQL (Dashboard → SQL Editor):**

1. `supabase/VERIFY-SUPABASE-ALL.sql` — extensions, all required tables, `avatars` bucket, `cron.job` list  
2. `supabase/CHECK-TABLES-AND-COLUMNS.sql` — same tables + **critical column** gaps (empty = OK)  
3. `scripts/verify-cron-jobs.sql` — cron detail (redundant with #1 if you ran full verify)

**Quick fixes:**

```bash
# Deploy every function from this repo (after linking CLI: supabase link)
npm run supabase:deploy-functions
```

**Cron (all notification timers in one go):** run **`scripts/setup-all-notification-crons.sql`** in the SQL Editor (requires Vault `project_url`, `anon_key`, `cron_secret` and matching **`CRON_SECRET`** on the four cron-invoked functions). Verify with **`scripts/verify-cron-jobs.sql`**.

---

## 1. Edge Functions (repo → production)

| Function | Used by | Repo | Notes |
|----------|---------|------|--------|
| `send-announcement-push` | App, admin-setup | ✅ | Push for likes, comments, announcements, B2B ops |
| `process-scheduled-announcements` | Cron | ✅ | Needs **cron every ~1 min** |
| `notify-event-starting-soon` | Cron | ✅ | Needs **cron every ~2 min** + `session_reminder_sent` |
| `notify-b2b-meeting-soon` | Cron | ✅ | Needs **cron every ~2 min** + `b2b_meeting_reminder_sent` |
| `nudge-b2b-meeting-feedback` | Cron | ✅ | Needs **cron ~15 min** + feedback nudge table |
| `auto-deactivate-events` | Cron | ✅ | Daily cron |
| `get-r2-upload-url` | `lib/image.ts` | ✅ | R2 uploads; `verify_jwt = false` in `config.toml` |
| `upload-image-to-r2` | `lib/image.ts` | ✅ | Same |
| `delete-user` | Admin + delete-account | ✅ | Platform admin / self-delete |
| `set-event-creator-admin` | (triggers / one-off) | ✅ | Optional flows |
| `bulk-create-users` | `admin-setup` Members | ✅ | Deploy with `npm run supabase:deploy-functions` |

**Orphan on some projects:** `create-event-request` may exist in Dashboard without a copy in this repo — safe to ignore or remove if unused.

`supabase/config.toml` sets `verify_jwt = false` for cron-oriented and R2 functions so **pg_cron** and clients that pass custom auth still work. Redeploy after changing `config.toml`.

---

## 2. Database tables (public)

Core app tables should exist: `users`, `events`, `event_members`, `posts`, `likes`, `comments`, `messages`, `notifications`, `announcements`, `schedule_sessions`, `user_schedule`, `point_rules`, `point_log`, `connections`, `connection_requests`, `blocked_users`, `user_reports`, `chat_groups`, `chat_group_members`, `group_messages`, **`chat_group_event`** (junction for group RLS — see `supabase/FIX-GROUP-RECURSION.sql`), `vendor_booths`, `meeting_slots`, `meeting_bookings`, `session_ratings`, etc.

**One-shot verify:** run `supabase/CHECK-TABLES-AND-COLUMNS.sql` in the SQL Editor (tables + critical columns). Quick table list only: `supabase/VERIFY-TABLES.sql`.

**Reminder / B2B extras:**

| Table | Purpose |
|-------|--------|
| `session_reminder_sent` | Dedup for session 5‑min push |
| `b2b_meeting_reminder_sent` | Dedup for B2B 5‑min push |
| `b2b_meeting_feedback` / `b2b_meeting_feedback_nudge_sent` | B2B ratings + post-meeting nudge |

Idempotent SQL: `supabase/APPLY-ALL-MIGRATIONS.sql` or `npm run supabase:migrate` (requires DB URL in env for your script).

---

## 3. Extensions

- **pg_cron** + **pg_net** — required for scheduled Edge Function calls.
- **Vault** — store `project_url`, `cron_secret`, and (for announcements cron) `anon_key`.

---

## 4. Cron jobs (common gap)

A healthy project typically has **five** jobs (names must match your scripts):

1. `process-scheduled-announcements` — `scripts/setup-scheduled-announcements-cron.sql`
2. `notify-event-starting-soon` — `scripts/setup-event-starting-soon-cron.sql`
3. `notify-b2b-meeting-soon` — `scripts/setup-b2b-meeting-soon-cron.sql`
4. `nudge-b2b-meeting-feedback` — `scripts/setup-nudge-b2b-feedback-cron.sql`
5. `auto-deactivate-events` — `scripts/setup-auto-deactivate-events-cron.sql`

**Verify:** run `scripts/verify-cron-jobs.sql`. If only `auto-deactivate-events` appears, **scheduled announcements and 5‑minute reminders will not run** until you run the other setup scripts.

---

## 5. Edge Function secrets (Dashboard)

Per function docs, commonly:

- **CRON_SECRET** — same as Vault `cron_secret` for any function invoked by pg_cron.
- **SUPABASE_SERVICE_ROLE_KEY** — for functions that use admin client (often auto-injected).
- **R2** env vars — for `get-r2-upload-url` / `upload-image-to-r2` (see `R2-SETUP.md`).

---

## 6. Mobile app

- `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env` / EAS.
- Push: users need `users.push_token` populated (notifications permission + `registerPushToken`).
- Local B2B 5‑min reminders: **not** on Expo Go (`lib/meetingReminders.ts`).

---

## 7. Related docs

| Doc | Topic |
|-----|--------|
| `REMINDERS-5MIN-DEPLOY.md` | Session + B2B 5‑min pushes |
| `ANNOUNCEMENTS-SETUP.md` | Scheduled announcements + vault |
| `docs/NOTIFICATIONS-REFERENCE.md` | All notification types |
| `R2-SETUP.md` | Image uploads |
| `SETUP-STATUS.md` | Short status |

---

*Re-run MCP / SQL checks after changing cron or deploying functions.*
