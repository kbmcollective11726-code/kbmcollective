# Announcements – Full setup (Send now + Schedule)

This doc covers **Send now** and **Schedule** announcements end to end.

---

## What’s in the app

- **New announcement** (Event admin → New announcement): title, message, Send to (All / By role / Specific), Schedule (Send now / Schedule).
- **Send now**: Saves the announcement and sends in-app notifications + push to the chosen recipients immediately.
- **Schedule**: Saves the announcement with `scheduled_at` and targeting; a backend job sends it at that time (see below).

---

## 1. Database: run the migration

Run this in **Supabase → SQL Editor** so the `announcements` table has scheduling and targeting columns:

```sql
-- From scripts/migrate-announcements-targeting.sql
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'audience', 'specific')),
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL;
```

Or run the file: `scripts/migrate-announcements-targeting.sql`.

---

## 2. Edge Function: process scheduled announcements

The function **process-scheduled-announcements** runs on a schedule and:

- Finds announcements where `scheduled_at <= now()` and `sent_at IS NULL`
- Resolves recipients (All / By role / Specific) from `target_type`, `target_audience`, `target_user_ids`
- Inserts in-app notifications for each recipient
- Sends push via Expo Push API for users with `push_token`
- Sets `sent_at` on the announcement

**Deploy the function**

1. Deploy the function (Supabase Dashboard → Edge Functions → New function, or CLI):
   - Name: `process-scheduled-announcements`
   - Code: use `supabase/functions/process-scheduled-announcements/index.ts`
2. Set **Secrets** for the function:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (often set by default)
   - `CRON_SECRET`: a random string you’ll use in the cron job (e.g. `openssl rand -hex 24`)

---

## 3. Cron: run the function every minute

Use **pg_cron** + **pg_net** to call the Edge Function every minute.

1. In **Supabase → Database → Extensions**, enable **pg_cron** and **pg_net**.
2. Store secrets in **Vault** (SQL Editor), then run the cron setup:
   - See instructions and SQL in **scripts/setup-scheduled-announcements-cron.sql**.
   - That script schedules a job that POSTs to `/functions/v1/process-scheduled-announcements` with your `project_url`, `anon_key`, and `cron_secret` (same value as `CRON_SECRET` in the Edge Function).

After this, every minute the cron job will invoke the Edge Function, which will send any due scheduled announcements (notifications + push) and set `sent_at`.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Run `scripts/migrate-announcements-targeting.sql` in Supabase SQL Editor |
| 2 | Deploy Edge Function `process-scheduled-announcements`, set `CRON_SECRET` in its secrets |
| 3 | Enable pg_cron and pg_net; store Vault secrets; run `scripts/setup-scheduled-announcements-cron.sql` |

Then:

- **Send now** works from the app with no extra setup.
- **Schedule** saves the announcement and the cron + Edge Function send it at `scheduled_at`.
