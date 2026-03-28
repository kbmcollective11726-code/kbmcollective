# Setup status – what’s done and what to check

Quick reference so you can confirm everything is fully set up.

**End-to-end checklist for “session in 5 min” + “B2B meeting in 5 min”:** **[REMINDERS-5MIN-DEPLOY.md](./REMINDERS-5MIN-DEPLOY.md)** (SQL, vault, cron, `npm run supabase:deploy-reminders`).

**Full Supabase vs app audit (tables, all Edge Functions, cron gaps):** **[docs/SUPABASE-LIVE-AUDIT.md](./docs/SUPABASE-LIVE-AUDIT.md)** — run **`scripts/verify-cron-jobs.sql`** in the SQL Editor to see which scheduled jobs exist.

---

## Done in code / deploy

| Item | Status |
|------|--------|
| Back buttons go to previous page | Done (notifications, edit, admin, chat, schedule, expo booth) |
| B2B “meeting in 5 min” **push** (server) | Edge Function **deployed** (`notify-b2b-meeting-soon`) |
| Deep links for B2B push (tap → open booth) | Done in `lib/useDeepLink.ts` |
| In-app notification type `meeting` | Used by B2B reminder; icon in `constants/colors.ts` |

---

## You need to do (one-time)

### 1. ~~Create B2B reminder table~~ ✅ Done

Table `public.b2b_meeting_reminder_sent` has been created (verified).

### 2. Set Edge Function secret (if using cron)

In **Dashboard → Edge Functions → notify-b2b-meeting-soon → Settings**, add:

- `CRON_SECRET` = same value you use for other cron functions (e.g. from Vault `cron_secret`)

### 3. Schedule the B2B cron (so reminders actually run)

If you already use **pg_cron** + **pg_net** for `notify-event-starting-soon` or `process-scheduled-announcements`:

- In **SQL Editor**, run **`scripts/setup-b2b-meeting-soon-cron.sql`**.

That schedules the function every 2 minutes. Same Vault secrets (`project_url`, `cron_secret`) as your other cron jobs.

If you don’t use pg_cron yet, enable **pg_cron** and **pg_net** in **Database → Extensions**, add the Vault secrets (see ANNOUNCEMENTS-SETUP.md or `scripts/setup-scheduled-announcements-cron.sql`), then run `scripts/setup-b2b-meeting-soon-cron.sql`.

---

## Optional checks

| Check | Where |
|-------|--------|
| Other migrations / tables | `npx supabase db push` failed earlier due to remote/local migration mismatch; run any missing migrations or SQL from your migration files in SQL Editor as needed. |
| Other crons | `notify-event-starting-soon`, `process-scheduled-announcements`, `auto-deactivate-events` – see ANNOUNCEMENTS-SETUP.md and `scripts/setup-*-cron.sql`. |
| Push tokens | Users get B2B push only if they have `users.push_token` set (app calls `registerPushToken` when logged in on a real device). |

---

## Summary

- **App and back navigation:** fully set up.
- **B2B meeting push:** function is deployed and table exists. To have reminders actually send on a schedule:
  1. Set `CRON_SECRET` on the function (Dashboard → Edge Functions → notify-b2b-meeting-soon → Settings).
  2. Run `scripts/setup-b2b-meeting-soon-cron.sql` so the function runs every 2 minutes.

After that, B2B “meeting in 5 min” is fully set up.
