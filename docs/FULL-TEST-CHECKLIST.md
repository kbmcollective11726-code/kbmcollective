# Full test checklist — KBM Connect

Use this to test the app end-to-end: push notifications (no duplicates), login/registration, all main pages, and performance.

---

## Before you start

- [ ] Run from **project root** (CollectiveLiveg), not admin-setup: `npx expo start --clear`
- [ ] Test on **Expo Go** or a dev build (push works on real device; limited in Expo Go)
- [ ] `.env` has `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Automated checks passed: `npm test` (TypeScript, config, Supabase tables)

---

## 1. Login & registration

- [ ] **Login** — Enter email/password → lands on Home (or Admin All Events if platform admin). No "Network request failed" if on same Wi‑Fi or tunnel.
- [ ] **Logout** — Profile → Log out → lands on Login.
- [ ] **Session persistence** — Log in, close app, reopen → still logged in.
- [ ] **Register** — Login → "Sign up" → name, email, password (8+ chars) → account created and/or "Check your email" if confirmation is on.
- [ ] **Forgot password** — Login → "Forgot password?" → enter email → (check Supabase Auth or inbox if configured).

---

## 2. Push notifications (no duplicates)

- [ ] **Permission** — On first use (or after reinstall), app may ask for notification permission; accept.
- [ ] **Single push per action** — e.g. have another user like your post or comment; you get **one** device notification (not two). Same for schedule change, connection request, group message.
- [ ] **Announcement** — Admin sends "Send now" announcement; each recipient gets **one** push (not duplicated).
- [ ] **B2B “meeting soon”** — If applicable, one reminder per meeting (no duplicate reminders for same slot).

*Code notes: Push token is registered only on SIGNED_IN / INITIAL_SESSION (not on every TOKEN_REFRESHED). Edge Function dedupes `recipient_user_ids` so one request never sends twice to the same user.*

---

## 3. Main pages load (no errors, fast)

- [ ] **Home (Info)** — Opens; event selector or current event; agenda link; announcements (if any); join/leave event.
- [ ] **Agenda (Schedule)** — Sessions and B2B meetings for selected day; tap session → modal with details and rating; tap B2B → booth screen. "Tap to rate this meeting" for past B2B.
- [ ] **Feed** — Posts load (or empty state); tap user → profile; like, comment, post (if available).
- [ ] **B2B (Expo)** — Booth list or “Your meetings”; open booth → details; rate past meeting (one modal, submit once).
- [ ] **Community** — Members/connections; tap user → profile or chat.
- [ ] **Leaderboard** — Points and list load.
- [ ] **Profile** — Your info, event; Edit profile, Notifications, Groups, Admin (if admin), Log out.

---

## 4. No errors or freezes

- [ ] No red error screens (e.g. no "Unable to resolve module" from wrong folder).
- [ ] No persistent "Network request failed" on login when connection is good (use tunnel if device and PC on different networks).
- [ ] Lists (feed, schedule, B2B, notifications) load without long freezes; pull-to-refresh works where available.
- [ ] Back/header back works consistently (notifications, chat, schedule, B2B booth, admin screens).

---

## 5. Quick automated check

From project root:

```bash
npm test
```

- TypeScript: no errors
- App config: EAS projectId, expo-notifications plugin
- Supabase: API and tables (events, users, notifications, session_ratings, etc.) return 200

---

## Summary

| Area              | What to verify                                      |
|-------------------|-----------------------------------------------------|
| Login/registration| Sign in, sign up, logout, session persistence      |
| Push notifications| One push per action; no duplicate device notifications |
| Pages             | Home, Agenda, Feed, B2B, Community, Leaderboard, Profile load and navigate |
| Performance       | No freezes; pull-to-refresh; back navigation        |
| Automated         | `npm test` passes                                   |

After all items are checked, the app is fully tested for these areas.
