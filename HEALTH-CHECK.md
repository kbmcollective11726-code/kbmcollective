# CollectiveLive – Full health check checklist

Use this after running `npm run check:health` to test **every aspect** of the app manually. Check off each item as you verify it.

---

## Before you start

- [ ] App builds and opens (Expo Go or dev build).
- [ ] No red errors in Metro/console on launch.
- [ ] You have at least: one event, one admin user, one regular user (for B2B/notifications).

---

## 1. Auth

- [ ] **Login** – Enter email/password → lands on Home (or Admin All Events if platform admin).
- [ ] **Logout** – Profile → Log out → lands on Login.
- [ ] **Session persistence** – Log in, close app completely, reopen → still logged in (no login screen).
- [ ] **Register** – Login screen → “Sign up” → register new user → lands in app.
- [ ] **Reset password** – Login → “Forgot password?” → enter email → (check inbox for reset link if configured).

---

## 2. Info tab (Home)

- [ ] Tab opens; event selector or current event shown.
- [ ] “Agenda” / schedule link opens Schedule tab.
- [ ] Announcements banner (if any) shows and link works.
- [ ] Join event / leave event works if applicable.
- [ ] Hamburger menu opens and links work (Agenda, etc.).

---

## 3. B2B tab

- [ ] Tab opens; for **attendee**: only booths with assigned meetings show (or empty state).
- [ ] Each card shows vendor name, **meeting time**, **location** (if set).
- [ ] Tapping a card opens **Booth detail** (vendor info + “Your meeting” card for attendee).
- [ ] Booth detail: no duplicate “Meeting details” block for attendee (only “Your meeting” card).
- [ ] **Admin**: “Go to Vendor booths” or list shows all booths; “Add vendor booth” works.
- [ ] **Admin**: Open a booth → “Assign meeting” → pick attendee, date, start/end time → Assign → meeting appears.
- [ ] **Admin**: “Edit” and “Cancel” on a meeting work; “Cancel all meetings” works.
- [ ] **Admin**: Booth edit screen: save changes, delete booth (with confirm) → redirects to booth list.
- [ ] **Deep link**: From a “Meeting starting soon” notification tap → app opens to that booth (dev build).

---

## 4. Feed tab

- [ ] Feed loads (posts or empty state).
- [ ] Tap a user avatar/name → opens user profile (feed/user/[id]).
- [ ] User profile: “Message” opens chat; “Edit profile” (if self) opens edit.
- [ ] Create post (if available): pick image, post → appears in feed.
- [ ] Like / comment (if available) work.
- [ ] Header profile icon → Profile tab.

---

## 5. Agenda tab (Schedule)

- [ ] Schedule loads (sessions or empty state).
- [ ] **Admin**: “Manage schedule” (or similar) opens admin schedule.
- [ ] Admin schedule: Add session, edit session, delete session (with notification) work.
- [ ] Session rating (if shown in modal) saves.
- [ ] Tapping a speaker/session link (if any) goes to correct screen.

---

## 6. Community tab

- [ ] Tab opens; members or connections list.
- [ ] Tap user → profile or chat opens correctly.
- [ ] Connect / disconnect (if applicable) work.

---

## 7. Rank tab (Leaderboard)

- [ ] Leaderboard loads (points / list).
- [ ] Tapping a user opens feed/user profile.

---

## 8. Profile tab

- [ ] Profile screen shows user info and event.
- [ ] **Edit profile** – change name/avatar/etc. → Save → updates.
- [ ] **Notifications** – opens notifications screen; list loads.
- [ ] **Groups** – opens groups list; create group, open group, send message (if applicable).
- [ ] **Admin** (if event admin) – opens admin menu.
- [ ] **Log out** – signs out and returns to Login.

---

## 9. Admin (from Profile)

- [ ] **Edit event** – save changes.
- [ ] **Edit info page** – save content.
- [ ] **Point rules** – view/edit.
- [ ] **Manage schedule** – same as Agenda admin (add/edit/delete sessions).
- [ ] **Vendor booths (B2B)** – list, add, edit, delete booth; assign/cancel/edit meetings (see B2B section).
- [ ] **Manage members** – list, change role if applicable.
- [ ] **Moderate posts** – approve/remove if applicable.
- [ ] **New announcement** – create/schedule; send now or schedule.
- [ ] **All events** (platform admin) – list and switch events.
- [ ] **Create new event** (platform admin) – create event.
- [ ] **Delete user account** (platform admin) – flow works if used.

---

## 10. Chat & groups

- [ ] **Chat** – From profile or feed user → open chat; send message; messages load.
- [ ] **Groups** – Create group → open → send message; messages load.

---

## 11. Notifications

- [ ] **In-app** – Notifications screen shows list; tapping item (if deep link) opens correct screen (post, chat, group).
- [ ] **Push** – On dev/build (not Expo Go): after login, push permission requested; sending test notification (e.g. announcement) delivers to device.
- [ ] **Meeting reminder** – B2B list loaded with upcoming meeting → after 5 min before meeting time, local “Meeting starting soon” notification (dev build); tap opens booth.

---

## 12. Deep links & notification taps

- [ ] **Post** – Notification with post_id opens Feed and highlights post (if supported).
- [ ] **Chat** – Notification with chat_user_id opens that chat.
- [ ] **Group** – Notification with group_id opens that group.
- [ ] **Meeting reminder** – Notification with boothId opens B2B booth detail.

---

## 13. Error handling & edge cases

- [ ] **No event selected** – Profile/schedule show appropriate empty or “Select event” state.
- [ ] **Invalid booth ID** – Opening deleted booth (admin edit) shows “Booth not found” and redirects.
- [ ] **Booth detail** – Deleted booth shows “Booth not found” (no crash).
- [ ] **Offline / bad network** – App shows errors or retry instead of hanging (where implemented).

---

## 14. Performance & UX

- [ ] No long freezes on main screens (feed, schedule, B2B list).
- [ ] Pull-to-refresh works on list screens (feed, B2B, schedule, notifications).
- [ ] Back button / header back consistently returns to previous screen.

---

## Quick command reference

```bash
# Automated checks (env, TypeScript, config, Supabase, key files)
npm run check:health

# Or run the existing full test suite
npm test
```

When everything above is checked, the app has had a **complete test** of auth, every tab, every main button/link, notifications, B2B, and admin flows.
