# Build & login verification checklist

Last check: APK + iOS builds and user login flow.

## EAS build config (eas.json)

| Item | Status |
|------|--------|
| **Preview** (APK) has `env.EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes – both set |
| **Production** (iOS IPA / Android AAB) has same Supabase env | Yes – both set |
| Preview: `android.buildType: apk` | Yes |
| Production: `android.buildType: app-bundle`, iOS default | Yes |

→ **APK and iOS builds will have Supabase config at build time; no "Not configured" in built apps.**

---

## App config (app.json)

| Item | Status |
|------|--------|
| `android.googleServicesFile` | `"./google-services.json"` (no space in path) |
| `android.package` | `com.kbmcollective.collectivelive` |
| `ios.bundleIdentifier` | `com.kbmcollective.collectivelive` |
| `expo.extra.eas.projectId` | Set (kbmcollective) |

---

## Android native

| Item | Status |
|------|--------|
| `android/settings.gradle` `rootProject.name` | `'KBMConnect'` (no space) |
| `android/app/build.gradle` `applicationId` | `com.kbmcollective.collectivelive` |
| `android/app/google-services.json` | Present, `package_name` matches |
| Root `google-services.json` | Present (used by EAS from app.json path) |

---

## Supabase & login

| Item | Status |
|------|--------|
| `lib/supabase.ts` | Reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; `isSupabaseConfigured` when URL not placeholder |
| `app/(auth)/login.tsx` | Shows "Not configured" only when `!isSupabaseConfigured`; otherwise calls `login()` |
| `stores/authStore.ts` | `login()` uses `supabase.auth.signInWithPassword`; session timeout 8s; `onAuthStateChange` keeps state in sync |
| `app/index.tsx` | Redirects to `/(tabs)/home` if authenticated, else `/(auth)/login`; 1.5s fallback so user never stuck on loading |

→ **With env in EAS, built app has real Supabase URL/key → login works and users can use the app.**

---

## Build commands

- **Android APK (preview, QR install):**  
  `eas build --platform android --profile preview`

- **iOS (TestFlight):**  
  `eas build --platform ios --profile production --auto-submit`

- **Android AAB (Play Store):**  
  `eas build --platform android --profile production`

---

## Assets

Ensure these exist (referenced by app.json):

- `./assets/icon.png`
- `./assets/adaptive-icon.png`
- `./assets/logo-full-transparent.png` (login screen)

If any are missing, the build or login screen may fail.
