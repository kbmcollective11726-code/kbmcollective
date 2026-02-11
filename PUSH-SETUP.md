# Push notifications setup (CollectiveLive)

This guide covers what’s already in place and what you need to do so users receive push notifications on real devices.

---

## What’s already done in the app

- **expo-notifications** and **expo-device** installed; **expo-notifications** plugin in `app.json`
- **Permission + token**: On login, the app requests notification permission and saves the Expo push token to `users.push_token` (see `lib/pushNotifications.ts` and `stores/authStore.ts`)
- **Backend**: Supabase Edge Function `send-announcement-push` sends push via Expo’s API when admins send announcements
- **Announcements**: Sending an announcement (Send now) creates in-app notifications and triggers push for all recipients who have a `push_token`

So the **code path** for push is in place. What’s left is **credentials and builds** so the device can get a valid push token and receive notifications.

---

## What you need to do

Push does **not** work in **Expo Go** (SDK 53+). It only works in a **development build** or **production build** installed on a **real device**.

### 1. EAS project and `projectId`

The Expo push token is tied to an EAS project. You need a `projectId` in your app config.

1. Install EAS CLI (if needed):
   ```bash
   npm install -g eas-cli
   ```
2. Log in and link the project:
   ```bash
   eas login
   eas init
   ```
   When prompted, create/link an EAS project. This gives you a **project ID** (UUID).

3. Put that ID in `app.json` under `extra.eas.projectId`:
   ```json
   "expo": {
     "extra": {
       "eas": {
         "projectId": "YOUR_EAS_PROJECT_ID_HERE"
       }
     }
   }
   ```
   (If `extra` or `extra.eas` already exist, just add/update `projectId`.)

4. Restart the dev server after changing `app.json`.

Without a valid `projectId`, `getExpoPushTokenAsync()` can fail or produce tokens that won’t receive push.

---

### 2. Build the app (required for push)

Run a build so the app is compiled with the correct push entitlements/credentials:

- **Development build** (for testing):
  ```bash
  eas build --profile development --platform android
  eas build --profile development --platform ios
  ```
- **Production build** (for TestFlight/App Store/Play Store):
  ```bash
  eas build --profile production --platform android
  eas build --profile production --platform ios
  ```

Install the built app on a **real device** (not simulator/emulator). Push is not supported in Expo Go.

---

### 3. Android: FCM (Firebase Cloud Messaging)

Expo uses FCM to deliver push on Android. EAS can use your FCM credentials.

1. In [Firebase Console](https://console.firebase.google.com/), create or select a project and add an Android app with package name: `com.kbmcollective.collectivelive` (from your `app.json`).
2. Get FCM **V1** credentials (e.g. service account JSON).  
   Full steps: [Expo – Add Android FCM V1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials).
3. In your Expo project, run:
   ```bash
   eas credentials
   ```
   Choose **Android** → **Push Notifications: Manage your FCM Api Key** (or FCM V1 credentials) and upload/configure as instructed.

After that, EAS Build will use these credentials when building the Android app.

---

### 4. iOS: Apple Developer account + APNs

Push on iOS requires Apple Push Notification service (APNs).

1. **Apple Developer account** (paid) is required.
2. On **first** `eas build` for iOS, EAS will prompt you to:
   - Set up push notifications for the project
   - Generate an Apple Push Notifications key (or use an existing one)
   Answer **yes** to enable push.
3. Optional: run `eas credentials`, select **iOS**, then **Push Notifications: Manage your Apple Push Notifications key** to configure or rotate the key.

Register the device you’re testing on (e.g. via EAS “register device” or Apple Developer portal) if you’re using ad-hoc or development builds.

---

### 5. Test that push works

1. Build and install the app on a **physical device** (see step 2).
2. Log in so the app can request notification permission and save the Expo push token to `users.push_token`.
3. **Quick test**: Use [Expo Push Notifications tool](https://expo.dev/notifications):
   - Get the Expo push token from your app (e.g. log `tokenResult?.data` in `registerPushToken` or from `users.push_token` in Supabase).
   - Enter that token and send a test notification. You should see it on the device.
4. **In-app test**: As an admin, send an announcement (Send now) to yourself or a test user who is logged in on the device. They should get both the in-app notification and a push notification.

If the token is saved but no push arrives, check: correct `projectId`, FCM (Android) or APNs (iOS) credentials in EAS, and that you’re not using Expo Go.

---

## Summary checklist

| Step | What to do |
|------|------------|
| 1 | Run `eas init`, get EAS project ID, add `extra.eas.projectId` to `app.json` |
| 2 | Create a **development** or **production** build with `eas build` and install on a **real device** |
| 3 | **Android**: Configure FCM V1 credentials in Firebase, then in `eas credentials` for Android |
| 4 | **iOS**: Use a paid Apple Developer account; when EAS prompts, enable push and APNs key |
| 5 | Open the built app, log in, allow notifications, then test with Expo’s push tool or an announcement |

Once this is done, users with the built app and notification permission will receive push for announcements (and for any other triggers you add that call your push-sending Edge Function).
