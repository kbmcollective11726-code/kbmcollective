# Push not working (especially “5 minutes before session”)

## Root cause we see most often: **cron never calls the Edge Function**

5‑minute session reminders are **not** sent from the phone. Supabase must run **`notify-event-starting-soon` every ~1–2 minutes** via **pg_cron**.

Check in **Supabase → SQL Editor**:

```sql
SELECT jobname, schedule FROM cron.job ORDER BY jobname;
```

You should see a row named **`notify-event-starting-soon`**.  
If you **only** see `auto-deactivate-events`, the session reminder job **never runs** — no one will get that push.

### Fix (one-time)

1. **Vault secrets** (if not already): `project_url`, `cron_secret`, and **`anon_key`** (same as `ANNOUNCEMENTS-SETUP.md`).
2. **Edge Function secret**: Dashboard → **notify-event-starting-soon** → Secrets → **`CRON_SECRET`** = same string as vault `cron_secret`.
3. **SQL**: run **`scripts/setup-session-reminder-5min.sql`** (table `session_reminder_sent`), then **`scripts/setup-event-starting-soon-cron.sql`**.

If the job already exists and you need to replace it:

```sql
SELECT cron.unschedule('notify-event-starting-soon');
```

Then run `setup-event-starting-soon-cron.sql` again.

4. **Redeploy** the function after pulling latest code:  
   `npx supabase functions deploy notify-event-starting-soon`

---

## Other requirements

| Check | Why |
|--------|-----|
| User is **`event_members`** for that event | Function only notifies members of the session’s event |
| **`users.push_token`** not null | Dev/production build, not Expo Go; notifications allowed |
| Session **`is_active` = true** | Inactive sessions are skipped |
| **`start_time`** is a real instant in the DB | Window is “now + 4–6 minutes” in **UTC**; bad timestamps never match |
| Row not already in **`session_reminder_sent`** | One successful send per session (failed sends can retry after function update) |

---

## Quick manual test

After cron is set, open **Edge Functions → notify-event-starting-soon → Logs**. You should see invocations every 2 minutes (often `sent: 0`).

Manual POST (replace project ref and secret):

```http
POST https://YOUR_REF.supabase.co/functions/v1/notify-event-starting-soon
Content-Type: application/json
x-cron-secret: YOUR_CRON_SECRET

{}
```

---

## B2B “5 minutes before meeting”

Same idea: cron job **`notify-b2b-meeting-soon`** + **`scripts/setup-b2b-meeting-soon-cron.sql`**.

---

## In-app pushes (likes, comments, etc.)

Those use **`send-announcement-push`** from the app with the user’s JWT — different path. If **only** the 5‑minute session push fails, fix **cron** first.
