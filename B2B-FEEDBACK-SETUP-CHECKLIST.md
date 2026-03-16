# B2B & feedback setup checklist

Use this to confirm **tables, RLS, RPC, and nudge** are fully set up in Supabase.

---

## 1. Tables and policies (run once in Supabase)

In **Supabase Dashboard → SQL Editor → New query**:

1. Open **[supabase/RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql](supabase/RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql)**.
2. Copy the entire file, paste into the SQL Editor, and **Run**.

This will:

- Update **meeting_bookings** RLS so only admins can create/edit/cancel (attendees and vendors cannot).
- Create **b2b_meeting_feedback** (rating, comment, meet again, recommend, work-with likelihood) and its RLS.
- Create **b2b_meeting_feedback_nudge_sent** (one row per booking when we send the “rate this meeting” nudge) and its RLS.
- Create the **get_b2b_vendor_performance** RPC for the admin Vendor performance screen.

**Prerequisites:** Your project must already have `meeting_bookings`, `meeting_slots`, `vendor_booths`, `event_members`, and the helpers `is_event_admin()` and `is_platform_admin()` (from earlier migrations or APPLY-ALL-MIGRATIONS.sql).

---

## 2. Verify tables exist

In the SQL Editor, run **[supabase/VERIFY-TABLES.sql](supabase/VERIFY-TABLES.sql)**.

You should see rows for (among others):

- `b2b_meeting_feedback`
- `b2b_meeting_feedback_nudge_sent`
- `b2b_meeting_reminder_sent`
- `meeting_bookings`, `meeting_slots`, `vendor_booths`, `session_ratings`, etc.

If any of these are missing, run the migrations that create them (e.g. RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql and your main schema / APPLY-ALL-MIGRATIONS).

---

## 3. Nudge Edge Function (optional but recommended)

To send a **push nudge** after a B2B meeting (“Rate your meeting with [Vendor]”):

1. Deploy the function:
   ```bash
   supabase functions deploy nudge-b2b-meeting-feedback
   ```
2. In **Supabase Dashboard → SQL Editor**, run **[scripts/setup-nudge-b2b-feedback-cron.sql](scripts/setup-nudge-b2b-feedback-cron.sql)** to schedule it every 15 minutes.

Requires: **pg_cron** and **pg_net** enabled, and vault secrets **project_url** and **cron_secret** set (same as for `notify-b2b-meeting-soon`).

---

## 4. Summary: “Is everything set up including the tables?”

| Item | Where | Status |
|------|--------|--------|
| B2B admin-only create/edit/cancel | RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql | Run once in SQL Editor |
| **b2b_meeting_feedback** table + RLS | Same file | Run once in SQL Editor |
| **b2b_meeting_feedback_nudge_sent** table + RLS | Same file | Run once in SQL Editor |
| **get_b2b_vendor_performance** RPC | Same file | Run once in SQL Editor |
| Verify tables | VERIFY-TABLES.sql | Run to confirm |
| Nudge push + cron | Deploy function + setup-nudge-b2b-feedback-cron.sql | Optional |

After you run **RUN-B2B-AND-FEEDBACK-MIGRATIONS.sql** once, all B2B and feedback **tables and policies** are set up. The app (booth “Rate this meeting”, admin “Vendor performance”) will work. The nudge is an extra step for push reminders.
