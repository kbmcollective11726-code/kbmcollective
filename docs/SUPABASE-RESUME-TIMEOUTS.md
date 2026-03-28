# Supabase & “Page not loading” after minimize/reopen

## Supabase setup — verified

- **Project URL**: `https://noydhokbswedvltjyenr.supabase.co` (matches `.env` and MCP).
- **Keys**: Anon key is set in `.env`; app reads it via `app.config.js` → `Constants.expoConfig.extra` in Expo Go.
- **Dashboard API logs**: When requests **reach** Supabase, they return **200** (auth refresh, REST, storage). So the project is up and config is correct.

## What’s actually happening

The console shows **“Request timed out”** and **“Session refresh failed”** after you minimize and reopen the app. So:

- **Supabase is fine** — when a request completes, it succeeds (200).
- **The problem is on the device/network** — after backgrounding, many requests **never complete** within the timeout (e.g. 35s). So the app times out before Supabase responds.

Typical causes:

1. **Network reconnection** — iOS/Android can suspend or drop sockets when the app is in the background. When the app becomes active again, new connections to Supabase can be slow to establish.
2. **Different network** — e.g. phone on cellular or a different Wi‑Fi than the one that was used before backgrounding.
3. **Expo Go + LAN** — If the device is not on the same LAN as the machine running Metro, or the network is strict (corporate/school), outbound HTTPS to Supabase can be slow or blocked.

## What we changed in the app

- **Longer timeouts** in `lib/supabase.ts`: request 35s, refresh 18s, so slow reconnection has more time.
- **Single refresh on resume**: Only the root layout runs `refreshSessionIfNeeded()` when AppState becomes `active`; Profile, Notifications, and Groups wait for that (up to 18s) then load. This avoids several refreshes at once.
- **Reachability check** (dev only): When the app becomes active, we log whether the device can reach Supabase (see console `[Supabase] Reachable after resume` / `Not reachable`).

## What you can do

1. **Same Wi‑Fi** — Keep phone and dev machine on the same Wi‑Fi when testing.
2. **Use tunnel** — Run `npx expo start --tunnel` so the device reaches Metro over the internet; often improves stability when LAN is flaky.
3. **After resume** — Wait a few seconds before opening Profile/Notifications/Groups so the network can re-establish; pull-to-refresh if a screen is stuck.
4. **Debug panel** — Use the in-app “Test Supabase” (or similar) to see current reachability.

Supabase project and config are correct; the remaining issue is device connectivity/timeouts after app resume.
