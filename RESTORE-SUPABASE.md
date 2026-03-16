# Restore Supabase tables and setup

If your tables were deleted, run the following in **Supabase Dashboard → SQL Editor** in this order.

## Step 1: Full schema (all tables, RLS, triggers, storage)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your **CollectiveLive** project.
2. Go to **SQL Editor** → **New query**.
3. Open the file **`supabase-schema.sql`** in this project (root folder).
4. Copy its **entire** contents and paste into the SQL Editor.
5. Click **Run** (or Ctrl+Enter).
6. Wait for it to finish. You should see "Success. No rows returned."

This creates:

- **Tables:** `users`, `events`, `event_members`, `posts` (with `image_hash`), `likes`, `comments`, `schedule_sessions`, `user_schedule`, `messages`, `announcements`, `notifications`, `point_rules`, `point_log`, `vendor_booths`, `meeting_slots`, `meeting_bookings`, `connections`, `connection_requests`
- **RLS** and all policies
- **Triggers:** new user → profile row, likes/comments counts, points, event code, creator as admin
- **Storage buckets:** `avatars`, `event-photos`, `event-assets`
- **Realtime** for posts, likes, comments, messages, notifications, etc.

## Step 2: Announcements targeting (optional columns)

1. In SQL Editor, **New query**.
2. Copy the full contents of **`scripts/migrate-announcements-targeting.sql`**.
3. Paste and **Run**.

Adds: `target_type`, `target_audience`, `target_user_ids`, `scheduled_at`, `sent_at` to `announcements`.

## Step 3: Block and report tables

1. In SQL Editor, **New query**.
2. Copy the full contents of **`scripts/migrate-block-report.sql`**.
3. Paste and **Run**.

Creates: `blocked_users`, `user_reports` and their RLS.

---

## Users and auth

- **User rows** are created automatically when someone signs up (trigger `on_auth_user_created` inserts into `public.users` from `auth.users`).
- You do **not** need to create user rows by hand for new signups.
- Existing **Auth users** (in Dashboard → Authentication → Users) will **not** get a row in `public.users` until they sign in again (the app fetches/creates profile on login). If you need a row for an existing auth user, insert one in **Table Editor** or SQL:

```sql
INSERT INTO public.users (id, email, full_name)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;
```

Run that once to backfill `public.users` from all existing auth users.

---

## Make yourself platform admin (optional)

To see all events and act as super admin (e.g. viperv18@hotmail.com):

1. Get your user id: **Authentication → Users** → click your user → copy **User UID**.
2. SQL Editor → New query:

```sql
UPDATE public.users
SET is_platform_admin = true
WHERE email = 'viperv18@hotmail.com';
-- or: WHERE id = 'YOUR-USER-UUID-HERE';
```

3. Run.

---

## Verify

- **Table Editor:** In the left sidebar you should see all tables under **public**.
- **Authentication:** Ensure **Email** provider is enabled (Authentication → Providers).
- Try logging in from the app again (after restoring the project if it was paused).
