# Before rebuilding iOS – checklist

Quick list so nothing is missed before `eas build --platform ios --profile production` (or TestFlight auto-submit).

---

## 0. Run checks and apply migrations (required)

Run the full test suite. It must pass before rebuilding iOS:

```bash
npm test
```

- **TypeScript** – must pass (no type errors).
- **App config** – EAS projectId and expo-notifications must be set.
- **Supabase** – all 27 tables must return 200. If any show ✗ (e.g. 500):
  - In Supabase Dashboard → SQL Editor, run the migrations in **supabase/migrations** in order (oldest first).
  - For **group chat** (chat_groups, chat_group_members, group_messages): run `20260303000000_messages_attachment_and_group_chat.sql`, then the RLS fix migrations (`20260304...`, `20260311...`, `20260312...`). If groups still misbehave, run **supabase/FIX-GROUP-RECURSION.sql** (adds helpers and policies).
- Do not proceed to build until `npm test` passes.

---

## 1. Bump iOS build number (recommended)

App Store Connect rejects uploads if the build number is not greater than the last one.

- **Current in app.json:** `ios.buildNumber`: `"13"`
- **Action:** If you already submitted build 13, set `"buildNumber": "14"` (or next) in **app.json** under `expo.ios`.

---

## 2. EAS production env (already set)

Your **eas.json** `production` profile already has:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

So the iOS build will talk to your real Supabase. No change needed unless you use a different project for production.

---

## 3. Auto-submit to TestFlight (optional)

If you use:

```bash
eas build --platform ios --profile production --auto-submit --non-interactive
```

then in **eas.json** under `submit.production.ios` you can set your App Store Connect app ID so EAS knows where to submit:

```json
"submit": {
  "production": {
    "ios": {
      "ascAppId": "YOUR_APPLE_APP_ID"
    }
  }
}
```

- **Where to get it:** App Store Connect → Your app → App Information → **Apple ID** (numeric).
- If you don’t set it, you can still run `eas submit --platform ios --latest` manually after the build finishes.

---

## 4. Apple credentials (first time / new machine)

- **First iOS build on EAS:** You may be prompted for Apple ID and app-specific password (or EAS will open a browser to sign in). Have them ready.
- **Push notifications:** EAS typically manages the push certificate/profile when you use `expo-notifications`; no extra step unless you had custom setup.

---

## 5. Version / display name (optional)

- **Version (user-facing):** `app.json` → `expo.version` (e.g. `"1.0.0"`). Bump when you want a new “version” in the store (e.g. 1.0.1).
- **Name:** `expo.name` is "KBM Connect" – fine unless you’re rebranding.

---

## 6. Quick command reference

```bash
# Build only (no submit)
eas build --platform ios --profile production --non-interactive

# Build + submit to TestFlight when build finishes
eas build --platform ios --profile production --auto-submit --non-interactive

# Or use the npm script
npm run build:ios:testflight
```

---

## Summary

| Step | Action |
|------|--------|
| npm test | Run and fix until all checks pass (TS, app config, all Supabase tables). |
| Migrations | If any table ✗, run supabase/migrations (and FIX-GROUP-RECURSION.sql if needed). |
| Bump build number | In app.json set `ios.buildNumber` to next (e.g. 14) if you already submitted 13. |
| EAS env | Already set in eas.json for production. |
| ascAppId | Optional; set in eas.json if you use auto-submit and want it automatic. |
| Apple credentials | Have Apple ID + app-specific password (or browser login) ready if prompted. |

After that, you’re good to run the iOS build.
