# Notification Bell – How It Works

## What the bell does

- **Blue bell** = no unread notifications
- **Red bell + badge** = you have unread notifications (count shown in badge)

The bell only counts notifications for the **current event**. If you switch events, the count updates for that event.

---

## Flow when someone likes or comments on your post

1. **User B** likes or comments on **User A’s** post.
2. The app inserts a row into the `notifications` table with:
   - `user_id` = User A (post owner)
   - `event_id` = the event where the post lives
   - `is_read` = false
3. **User A’s bell** gets the new count in one of these ways:
   - **Realtime** – Supabase sends an INSERT/UPDATE event to the app
   - **Polling** – Every 15 seconds when the app is open
   - **App focus** – When the app comes back to foreground
4. When the new unread count > 0, the bell turns red and shows the badge.

---

## Why the bell might not update immediately

| Cause | What happens |
|-------|--------------|
| **Different event** | You’re viewing Event B, but the like/comment was on a post in Event A. The bell only shows unread for the event you’re viewing. |
| **Realtime not firing** | Supabase Realtime can sometimes miss events. That’s why there’s a 15-second polling fallback. |
| **App in background** | The bell doesn’t poll while the app is in background. When you bring the app back to foreground, it refetches. |
| **Expo Go** | If you’re using Expo Go, Realtime and polling should still work, but full push behavior may differ from a production build. |

---

## Checklist for testing

1. **Same event** – Both users must be in the same event.
2. **Post owner in app** – The post owner (User A) must have the app open or in foreground.
3. **Wait up to 15 seconds** – If Realtime misses the event, polling updates within ~15 seconds.
4. **Switch back to app** – If the app was backgrounded, the bell updates when you return.

---

## Database requirements

- `notifications` must be in the `supabase_realtime` publication (already set).
- `notifications` should use `REPLICA IDENTITY FULL` for reliable Realtime filters (migration applied).
