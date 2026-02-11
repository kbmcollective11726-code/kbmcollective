# Build push notifications — do these in order

Follow these steps in order. You need a **real Android device** (or iOS device) to test push; Expo Go does not support push.

---

## Step 1: EAS project ID

In the project folder:

```bash
npm install -g eas-cli
eas login
eas init
```

- When asked, **create** or **link** an EAS project.
- After `eas init`, you’ll see a **project ID** (UUID like `a1b2c3d4-...`).

**Update app.json:** replace `REPLACE_WITH_YOUR_EAS_PROJECT_ID` with that ID (in `expo.extra.eas.projectId`).

---

## Step 2: Firebase (Android)

**Option A — Firebase CLI**

```bash
npm install -g firebase-tools
firebase login
firebase projects:create
# Enter project ID when prompted (e.g. collectivelive-push)
firebase use <YOUR_FIREBASE_PROJECT_ID>
firebase apps:create android "CollectiveLive" --package-name com.kbmcollective.collectivelive
```

**Option B — Firebase Console**

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a project (or use existing).
3. Add app → Android → package name: `com.kbmcollective.collectivelive`.

**Then (both options):**

1. In Firebase Console: **Project settings** → **Your apps** → Android app → **Download `google-services.json`**.
2. Put `google-services.json` in the **project root** (same folder as `app.json`).  
   `app.json` is already set to use `./google-services.json`.
3. **Project settings** → **Service accounts** → **Generate new private key** → save the JSON somewhere safe (e.g. `firebase-service-account.json` in project root).  
   **Do not commit this file** (it’s in `.gitignore`).

---

## Step 3: Upload FCM key to EAS

```bash
eas credentials
```

- Select **Android**.
- Select **production** (or **development** if you’re building a dev client).
- Go to **Google Service Account** → **Manage your Google Service Account Key for Push Notifications (FCM V1)**.
- Choose **Upload a new service account key** and select the JSON file you downloaded in Step 2.

---

## Step 4: Build the app

**Android (APK for testing):**

```bash
eas build --profile development --platform android
```

Or for a preview/production-like build:

```bash
eas build --profile preview --platform android
```

- Wait for the build on Expo’s servers.
- When it’s done, download the APK from the link EAS gives you (or scan the QR code on your phone).

---

## Step 5: Install and test

1. Install the APK on a **real Android device** (not an emulator).
2. Open the app, **log in**, and **allow notifications** when prompted.
3. **Test push:**  
   - As an admin, send an **announcement** (Send now) to yourself, or  
   - Use [expo.dev/notifications](https://expo.dev/notifications): get your Expo push token from Supabase (`users.push_token` for your user) and send a test notification.

If the device receives the notification (and vibrates/sounds when the app is closed or screen off), push is working.

---

## iOS (later)

For iPhone you need:

- Apple Developer account (paid).
- Run `eas build --profile development --platform ios` (or production).  
  On first iOS build, EAS will ask to set up push; choose **yes** and let it create an APNs key.

---

## Quick reference

| Step | What |
|------|------|
| 1 | `eas login` → `eas init` → put project ID in `app.json` |
| 2 | Firebase: create project + Android app → download `google-services.json` (project root) + service account JSON (keep local) |
| 3 | `eas credentials` → Android → upload FCM V1 service account JSON |
| 4 | `eas build --profile development --platform android` |
| 5 | Install APK on device → log in → allow notifications → test with announcement or expo.dev/notifications |
