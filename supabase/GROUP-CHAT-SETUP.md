# Group chat setup – summary

## What’s in place

### Database (run `ENSURE-ALL-TABLES.sql` or `RUN-IN-SQL-EDITOR.sql` in Dashboard)

- **Tables:** `chat_groups`, `chat_group_members`, `group_messages`
- **Helpers:** `is_event_admin()`, `is_platform_admin()`, `can_manage_chat_group_members()` (avoids RLS recursion)
- **chat_groups RLS**
  - **SELECT:** Event admin, platform admin, or member of the group
  - **INSERT:** Event admin or platform admin only
  - **UPDATE:** Event admin or platform admin (rename group)
  - **DELETE:** Event admin or platform admin (delete group)
- **chat_group_members RLS**
  - **SELECT:** Members of the group (see who’s in the group)
  - **ALL (INSERT/UPDATE/DELETE):** Event admin or platform admin via `can_manage_chat_group_members(group_id)`
- **group_messages RLS**
  - **SELECT:** Members of the group
  - **INSERT:** Sender must be the current user and a member of the group
- **Realtime:** `group_messages` is in `supabase_realtime` for live updates

### App

- **Create group (admin only):** Profile → Groups → “Create group” → name + select members → creates `chat_groups` row and `chat_group_members` rows.
- **List groups:** Shows groups the user is a member of (by `chat_group_members`).
- **Group conversation:** View messages, send text and images; realtime updates.
- **Manage members (admin only):** In the group screen, header “people” icon opens “Manage members”:
  - List current members with “Remove” (cannot remove yourself).
  - “Add from event” lists event members not in the group, with “Add”.

## Making sure it’s complete

1. Run **`supabase/ENSURE-ALL-TABLES.sql`** in Supabase Dashboard → SQL Editor (or use `RUN-IN-SQL-EDITOR.sql` for the RLS/helper part if tables already exist).
2. Confirm **`users.is_platform_admin`** and **`event_members.role` / `event_members.roles`** exist (ENSURE script adds them if missing).
3. Test: event admin creates a group, adds members, opens group, sends a message; open “Manage members”, add/remove someone; non-admin member only sees groups they’re in and can send messages.
