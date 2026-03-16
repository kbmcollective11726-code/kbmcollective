# TestFlight: iOS build and submit

## Automatic: build + push to TestFlight (recommended)

One command builds iOS and **automatically submits to TestFlight** when the build finishes:

```bash
npm run build:ios:testflight
```

Or: `eas build --platform ios --profile production --auto-submit --non-interactive`

- Build runs on EAS (10–20 min). When it finishes, EAS **automatically submits** to App Store Connect (TestFlight).
- Uses **production** env and `submit.production.ios` in `eas.json`. Have Apple credentials ready the first time.
- Status: [expo.dev](https://expo.dev) → your project → Builds.

**Auto-submit needs App Store Connect App ID:** In `eas.json`, under `submit.production.ios`, set `ascAppId` to your app’s numeric Apple ID from App Store Connect (My Apps → your app → App Information → Apple ID). Replace the placeholder if present.

---

## 1. Create iOS build (production) — manual flow

```bash
eas build --profile production --platform ios --non-interactive
```

- Uses your EAS project and **production** env vars (Supabase, etc.).
- Build runs on Expo servers (10–20 min). Check status: [expo.dev](https://expo.dev) → your project → Builds.
- **Note:** You’ve used your included build credits; extra builds are pay-as-you-go.

## 2. Submit to TestFlight (after build succeeds)

When the iOS build shows **Finished** in the dashboard:

```bash
eas submit --platform ios --latest
```

- Choose the build you just made when prompted (or use `--id <build-id>` to skip the prompt).
- You may be asked for Apple ID / App Store Connect; have your credentials ready.
- Build will upload to App Store Connect and appear in TestFlight for internal/external testers.

## 3. One-liner (build + submit later)

```bash
# Build (run first, wait for it to finish)
eas build --profile production --platform ios --non-interactive

# Then submit the latest build to TestFlight
eas submit --platform ios --latest
```

## Included in this build

- All app features: Feed, Connect/Community, Schedule, Info, Announcements, Event switcher, Admin, B2B (vendor booths + meetings), Notifications (push + meeting reminders), etc.
- Production Supabase and env vars from EAS **production** secrets.
- Bundle ID: `com.kbmcollective.collectivelive`.
