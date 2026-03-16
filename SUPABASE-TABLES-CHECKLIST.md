# Supabase tables checklist for CollectiveLive

Check in **Supabase Dashboard → Table Editor** that the **public** schema has these tables. The app expects all of them.

| # | Table name | Used for |
|---|------------|----------|
| 1 | `users` | User profiles (synced from Auth); push_token, full_name, avatar_url, etc. |
| 2 | `events` | Events (name, dates, banner, theme, event_code, welcome_message, etc.) |
| 3 | `event_members` | User membership in events; role, points, joined_at |
| 4 | `posts` | Photo posts (event_id, user_id, image_url, caption, likes_count, comments_count, is_pinned, is_approved, is_deleted) |
| 5 | `likes` | Post likes (post_id, user_id) |
| 6 | `comments` | Post comments (post_id, user_id, content) |
| 7 | `schedule_sessions` | Agenda sessions (event_id, title, start_time, end_time, day_number, etc.) |
| 8 | `user_schedule` | User bookmarks for sessions (user_id, session_id) |
| 9 | `point_rules` | Points config per event (event_id, action, points_value, max_per_day, description) |
| 10 | `point_log` | Points history (user_id, event_id, action, points, reference_id) |
| 11 | `connections` | Connected users per event (event_id, user_id, connected_user_id) |
| 12 | `connection_requests` | Pending connect requests (status: pending/accepted/declined) |
| 13 | `messages` | DMs (event_id, sender_id, receiver_id, content, is_read) |
| 14 | `notifications` | In-app notifications (user_id, title, body, is_read, etc.) |
| 15 | `announcements` | Admin announcements sent to event members |
| 16 | `blocked_users` | Block list (blocker_id, blocked_id) |
| 17 | `user_reports` | User reports (reporter_id, reported_id, reason, etc.) |
| 18 | `avatars` | Avatar image metadata (used by lib/image.ts) |

**Also required**

- **Auth**: Supabase Auth must be enabled (Dashboard → Authentication). The app uses email/password; `users` rows are usually created by a trigger or on first login from `auth.users`.
- **Storage**: Buckets for uploads (e.g. event photos, avatars) if the app uploads files via Storage.
- **RLS**: Row Level Security policies should be set so anon/authenticated can only read/write what they’re allowed to.

**How to check**

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **Table Editor**.
3. In the left sidebar, under **public**, confirm each table in the list above exists.
4. If any table is missing, create it (or run the migration that defines it).

**If SQL is timing out**

The “Connection terminated due to connection timeout” when running SQL (e.g. from MCP or external tools) is often due to **direct DB connection** (e.g. IPv4). The **app** uses the **API URL** (`https://xxx.supabase.co`) and **anon key**, not the direct Postgres connection, so the app can still work. Use the Dashboard (which uses Supabase’s own connection) to check and edit tables.
