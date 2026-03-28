# 5-minute reminders: sessions + B2B (deploy checklist)

These send **push notifications ~5 minutes** before:

| Feature | Edge Function | Dedup table |
|--------|----------------|-------------|
| Agenda / schedule sessions | `notify-event-starting-soon` | `session_reminder_sent` |
| B2B meetings | `notify-b2b-meeting-soon` | `b2b_meeting_reminder_sent` |

**Local B2B backup:** The app also schedules **local** notifications from `lib/meetingReminders.ts` when users open the Expo tab (`app/(tabs)/expo/index.tsx`). That path is **skipped in Expo Go**; use a dev/production build.

---

## 1) Database (Supabase → SQL Editor)

Run in order (idempotent where noted):

1. **Session dedup table**  
   `scripts/setup-session-reminder-5min.sql`

2. **B2B dedup table**  
   `supabase/run-b2b-reminder-table.sql`  
   **Or** run the full app SQL bundle (includes B2B reminder table):  
   `npm run supabase:migrate` → applies `supabase/APPLY-ALL-MIGRATIONS.sql`

3. **Vault secrets** (if not already set — same as scheduled announcements; **anon_key** is required so pg_cron can pass the Edge Function gateway JWT check):

   ```sql
   SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
   SELECT vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'anon_key');
   SELECT vault.create_secret('YOUR_CRON_SECRET_STRING', 'cron_secret');
   ```

4. **Cron jobs** (requires **pg_cron** + **pg_net** in Database → Extensions):

   - `scripts/setup-event-starting-soon-cron.sql` — every 2 minutes  
   - `scripts/setup-b2b-meeting-soon-cron.sql` — every 2 minutes  

   If a job name already exists, unschedule first:  
   `SELECT cron.unschedule('notify-event-starting-soon');`  
   `SELECT cron.unschedule('notify-b2b-meeting-soon');`

---

## 2) Edge Functions — secrets (Dashboard)

For **each** function: `notify-event-starting-soon`, `notify-b2b-meeting-soon`

- **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY** are usually injected automatically.
- Set **CRON_SECRET** to the **same** string as vault `cron_secret`.

If `CRON_SECRET` is set, callers must send header **`x-cron-secret`** (the cron SQL does this).

---

## 3) Deploy functions (CLI)

From the repo root (with [Supabase CLI](https://supabase.com/docs/guides/cli) linked to your project):

```bash
npm run supabase:deploy-reminders
```

Or manually:

```bash
npx supabase functions deploy notify-event-starting-soon
npx supabase functions deploy notify-b2b-meeting-soon
```

**Important:** This repo’s `supabase/config.toml` sets **`verify_jwt = false`** for both functions so **pg_cron** can call them with only `x-cron-secret` (no user JWT). Redeploy after pulling so Dashboard picks up the config.

---

## 4) Verify

1. **Dashboard → Edge Functions → Logs** — after ~2 minutes you should see invocations (may show `sent: 0` if no sessions/meetings in the 4–6 minute window).
2. **Manual test** (replace values):

   ```bash
   curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify-event-starting-soon" ^
     -H "Content-Type: application/json" ^
     -H "x-cron-secret: YOUR_CRON_SECRET" ^
     -d "{}"
   ```

3. **App:** Users need a saved **push token** on `users.push_token` (open app, grant notifications).

---

## 5) Troubleshooting

| Symptom | Check |
|--------|--------|
| 401 from function | `x-cron-secret` matches `CRON_SECRET`; cron SQL uses vault `cron_secret`. |
| 401 before function runs | Redeploy with updated `config.toml` (`verify_jwt = false`). |
| Function runs, no push | `users.push_token` populated; Expo project ID / FCM setup for the build. |
| Duplicate reminders | Dedup tables exist; cron interval ~1–2 min (not slower than the 4–6 min window). |
| Missing table error | Run step 1–2 SQL or `npm run supabase:migrate`. |

See also: `docs/NOTIFICATIONS-REFERENCE.md`, `SETUP-STATUS.md`.
