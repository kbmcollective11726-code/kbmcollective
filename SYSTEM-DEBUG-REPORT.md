# Full System Debug Report – CollectiveLive / KBM Connect

**Generated:** System-wide diagnostic run  
**Project:** KBM Connect (Expo 54, React Native, Supabase)

---

## 1. Summary

| Check | Status |
|-------|--------|
| TypeScript | ✅ No errors (`tsc --noEmit`) |
| .env Supabase | ✅ Valid (project ref: noydhokbswedvltjyenr) |
| Supabase API + tables | ✅ All 27 tables reachable (events, posts, users, etc.) |
| App config (EAS, notifications) | ✅ EAS projectId set, expo-notifications plugin |
| Key routes & libs | ✅ 25 key files present |
| R2 Edge Functions | ✅ get-r2-upload-url, upload-image-to-r2 present |
| Lint (edited files) | ✅ No linter errors |
| Leftover debug code | ✅ Removed (was in Profile, Notifications, Groups, supabase.ts) |

**Overall:** Automated checks **PASSED**. No code or config errors found. Optional: set `DATABASE_URL` in `.env` to run direct DB table checks from `health-check.mjs`.

---

## 2. Environment & Config

- **App name:** KBM Connect (`app.json` / `expo.name`)
- **Bundle IDs:** `com.kbmcollective.collectivelive` (iOS/Android)
- **Supabase:** Loaded from `.env` via `app.config.js` → `Constants.expoConfig.extra` (Expo Go) or `process.env` (builds)
- **Scripts:** `node scripts/check-env.mjs` validates URL + anon key; run after any `.env` change. Then `npx expo start --clear` so the app picks it up.

---

## 3. Supabase

- **Project ref:** noydhokbswedvltjyenr
- **Tables verified (HTTP 200):** events, schedule_sessions, point_rules, users, announcements, connections, connection_requests, event_members, posts, push_token (users), messages, notifications, likes, comments, user_schedule, session_ratings, vendor_booths, meeting_slots, meeting_bookings, chat_groups, chat_group_members, group_messages, blocked_users, user_reports, point_log, session_reminder_sent
- **Auth:** Session in AsyncStorage, `autoRefreshToken`, `persistSession`. No global 401 sign-out; `withRetryAndRefresh` handles refresh + retry per request.
- **Timeouts:** Request 20s, refresh 10s, screen load 30s with one auto-retry (Profile, Notifications, Groups). On app resume: 8s cap on session refresh then load runs anyway.

---

## 4. App Entry & Auth Flow

- **Entry:** `app/_layout.tsx` → `initialize()` from `authStore`, splash hide, then `app/index.tsx`.
- **Index:** Waits for `isLoading`; if authenticated → home or admin-all-events or change-password; else → login. Safety: 1.5s timeout then force login if still not navigated.
- **Auth store:** Zustand; `getSession()` (8s timeout), then `onAuthStateChange` for SIGNED_OUT / SIGNED_IN / TOKEN_REFRESHED. Push token registered on sign-in (non-Expo builds only).

---

## 5. Key Screens & Data Loading

- **Profile:** `loadStats()` → `withRetryAndRefresh(fetchPointsAndRole)`. Points from `event_members`, posts count from `posts` (with fallback select if count fails), role from `event_members`. In-flight guard; on AppState active: reset guard, set loading, await refresh (max 8s), then load.
- **Notifications:** `fetchNotifications()` with in-flight guard; same resume flow (refresh timeout + load).
- **Groups:** `fetchGroups()` + `fetchAdmin()`; same resume flow. Requires `currentEvent?.id`.
- **Feed, Schedule, Community:** Use in-flight or similar guards; session check no longer blocks load (load always attempted).

---

## 6. Fixes Applied During This Debug

1. **Removed leftover debug instrumentation** from:
   - `lib/supabase.ts` (withRetryAndRefresh)
   - `app/(tabs)/profile/index.tsx` (loadStats, AppState)
   - `app/(tabs)/profile/notifications.tsx` (fetchNotifications, AppState)
   - `app/(tabs)/profile/groups/index.tsx` (fetchGroups, AppState)  
   These were sending logs to a debug server (127.0.0.1:7672); removed to avoid stray network calls and clutter.

---

## 7. Recommendations

1. **Manual testing:** Follow `HEALTH-CHECK.md` and run through Auth, each tab (Info, Feed, Agenda, Community, Rank, Profile), Notifications, Groups, B2B, and admin flows.
2. **Expo Go + tunnel:** If requests time out on device, use `npx expo start --clear --tunnel` and ensure device can reach Supabase (or use Debug → Test connection in app).
3. **Development build:** For more reliable behavior (especially after minimize/reopen), consider a dev build: `eas build --profile development`.
4. **DATABASE_URL:** Optional. Add to `.env` (from Supabase Dashboard → Database → Connection string) to let `health-check.mjs` run direct table checks.
5. **Deprecation warning:** Health script triggered a Node deprecation (passing args with `shell: true`). Safe to ignore for now; can be fixed later by using `execSync`/spawn without shell where appropriate.

---

## 8. Commands Reference

```bash
# Validate .env
node scripts/check-env.mjs

# Full automated health check
node scripts/health-check.mjs

# TypeScript check
npx tsc --noEmit

# Run app (clear cache after .env change)
npx expo start --clear
npx expo start --clear --tunnel

# Supabase table check (script)
npm run supabase:check-tables
```

---

*End of system debug report.*
