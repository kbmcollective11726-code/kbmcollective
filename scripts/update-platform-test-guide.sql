INSERT INTO public.platform_test_guides (slug, title, content, updated_by, updated_at)
VALUES (
  'main-app-regression',
  'Main app regression test guide',
  $guide$
# CollectiveLive Phone Tester Guide (Plain English)

Use this guide every time we release an update.
Work from top to bottom.

## Quick rules
- Mark each step as Pass or Fail.
- If something fails, take a screenshot or video.
- Write simple notes: what you tapped, what you expected, what happened.
- If the app crashes, report it right away.

---

## 1) Must-run checks first (about 15 to 20 minutes)

- [ ] Open app from scratch. (Pass = app opens, no crash)
- [ ] Sign in with test account. (Pass = login works)
- [ ] Home page opens.
- [ ] Schedule page opens.
- [ ] Feed page opens.
- [ ] Expo / Solution Providers page opens.
- [ ] Photo Book page opens.
- [ ] Leaderboard page opens.
- [ ] Profile page opens.
- [ ] Sign out and sign back in.

If any item above fails, stop and report before continuing.

---

## 2) Account checks

- [ ] Wrong password shows a clear error.
- [ ] Reset password flow works from email link.
- [ ] Change password in profile works.
- [ ] Edit profile info and save.
- [ ] Profile image upload works.

---

## 3) Feed checks

- [ ] Create a text post.
- [ ] Create a post with photo.
- [ ] Like and unlike a post.
- [ ] Add a comment to a post.
- [ ] Delete your own comment.
- [ ] Open another user profile from a post.

---

## 4) Event and schedule checks

- [ ] Join/switch to the correct event.
- [ ] Event info page looks correct.
- [ ] Schedule list loads for the event.
- [ ] Open a session detail page.
- [ ] Session feedback works (if this event uses it).

---

## 5) Notification checks

- [ ] In-app alert appears when expected.
- [ ] Push notification arrives on phone.
- [ ] Tapping push notification opens the right screen.

---

## 6) Booth and networking checks (if enabled for event)

- [ ] Booth list loads.
- [ ] Booth detail page opens.
- [ ] Contact/action buttons work.
- [ ] Meeting request flow works.
- [ ] Meeting reminder appears correctly.
- [ ] Meeting feedback submit works.

---

## 7) Badge checks (if enabled for event)

- [ ] Badge is visible for correct user.
- [ ] Valid scan works.
- [ ] Invalid scan shows correct error.

---

## 8) Role checks

Test with these users if available:
- attendee
- speaker
- vendor
- admin

For each role:
- [ ] User can see what they should see.
- [ ] User cannot access admin-only areas unless admin.

---

## 9) Admin web checks (supporting app behavior)

In admin web:
- [ ] Event page opens.
- [ ] Schedule edit saves.
- [ ] Announcement publish works.
- [ ] Member role updates save.
- [ ] Photos / Sponsors / Booth pages load.

Then confirm changes appear in phone app.

---

## 10) Reliability checks

- [ ] Test once on good wifi.
- [ ] Test once on weaker internet.
- [ ] App shows loading/error messages clearly.
- [ ] No blank screens.
- [ ] No repeated duplicate actions from double taps.

---

## 11) Final release sign-off

Release is ready only if:
- [ ] All must-run checks pass
- [ ] No blocker bugs open
- [ ] Push notifications verified
- [ ] Core admin actions verified

---

## 12) Bug report format (copy/paste)

- Build version:
- Test date/time:
- Phone model:
- iOS/Android version:
- Test account email:
- Feature area (example: Feed, Schedule):
- Steps you followed:
- What you expected:
- What actually happened:
- Screenshot/video link:
- Severity: Blocker / High / Medium / Low

---

## 13) Add new tests for each release

For each release, add:
- New feature name
- Step-by-step test
- Expected result
- Pass/Fail
$guide$,
  NULL,
  NOW()
)
ON CONFLICT (slug) DO UPDATE
SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
