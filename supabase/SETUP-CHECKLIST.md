# Supabase setup checklist

Use this to confirm your Supabase project is ready for the app (groups, DMs, notifications, etc.).

## 1. Apply migrations

From the project root:

```bash
npx supabase db push
```

Or link your project first if needed:

```bash
npx supabase link --project-ref YOUR_REF
npx supabase db push
```

Migrations run in order and will:

- Add `is_event_admin()` and `is_platform_admin()` and `users.is_platform_admin` (if missing)
- Add message attachments and group chat tables + RLS
- Fix RLS recursion for `chat_group_members` (so admins can create groups)

## 2. Verify in SQL Editor

In **Supabase Dashboard → SQL Editor**, run the contents of **`VERIFY-SETUP.sql`**.

Check that:

- **1)** Returns 2 rows → `is_event_admin` and `is_platform_admin` exist
- **2)** Returns 1 row → `users.is_platform_admin` column exists
- **3)** Returns 3 rows → `chat_groups`, `chat_group_members`, `group_messages` exist
- **4)** Returns 2 rows → `messages.attachment_url` and `attachment_type` exist
- **5)** Returns at least 3 policies on `chat_groups`, including **"Admins can view chat groups in their event"** (this is the recursion fix)

If any check fails, apply the matching migration or run the script mentioned in the comments in `VERIFY-SETUP.sql`.

## 3. Optional: platform admin user

To make a user a platform admin (see all events, create events, etc.):

```sql
UPDATE public.users SET is_platform_admin = true WHERE id = 'auth-user-uuid-here';
```

Use the UUID from **Authentication → Users** in the dashboard.

## 4. Edge functions (push, cron)

For push notifications and scheduled jobs you need:

- **send-announcement-push** – used when sending announcement push and DM/message push
- **notify-event-starting-soon** – cron: “Event starting in 5 minutes”
- **process-scheduled-announcements** – cron: send scheduled announcements

Deploy with:

```bash
npx supabase functions deploy send-announcement-push
npx supabase functions deploy notify-event-starting-soon
npx supabase functions deploy process-scheduled-announcements
```

Set env (e.g. in Dashboard → Edge Functions → each function → Settings):  
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.  
For cron functions, set `CRON_SECRET` and call them from a cron job with header `x-cron-secret: YOUR_SECRET`.

## 5. Summary

| Item | Where |
|------|--------|
| Tables: chat_groups, chat_group_members, group_messages | migration `20260303...` |
| RLS recursion fix for group create | migration `20260304...` |
| Helpers: is_event_admin, is_platform_admin | migration `20260228100000...` |
| Verify everything | run `VERIFY-SETUP.sql` in SQL Editor |

After this, group creation and group messaging should work for event admins and members.
