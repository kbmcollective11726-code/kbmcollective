# Firebase + Firebase CLI setup for push (Android)

You can either use the **Firebase CLI** to create the project and Android app, or do it in the **Firebase Console**. The **service account key** (FCM V1) must be created in the Console and then uploaded to EAS.

---

## Don’t share credentials in chat or commit them

- **Do not** paste your Firebase service account JSON (private key) into chat or commit it to git.
- **Do** keep the key file only on your machine and add it to `.gitignore` (see below).
- **google-services.json** is safe to commit (it’s public config). The **service account key** JSON is secret.

---

## Option A: Firebase CLI (create project + Android app)

If you have Node 18+ and want to do it from the terminal:

### 1. Install and log in

```bash
npm install -g firebase-tools
firebase login
```

This opens a browser to sign in with your Google account.

### 2. Create a Firebase project

```bash
firebase projects:create
```

When prompted, enter a **project ID** (e.g. `collectivelive-push`). Note the project ID for the next step.

### 3. Use that project

```bash
firebase use <YOUR_PROJECT_ID>
```

Replace `<YOUR_PROJECT_ID>` with the ID from step 2.

### 4. Add an Android app to the project

```bash
firebase apps:create android "CollectiveLive" --package-name com.kbmcollective.collectivelive
```

This registers the Android app with the package name from your `app.json`.

### 5. What the CLI cannot do

- **Download google-services.json** – You still get this from Firebase Console: Project settings → Your apps → Android app → Download `google-services.json`. Put it in the project root (or e.g. `./google-services.json`).
- **Create the FCM V1 service account key** – You create this in Firebase Console: Project settings → Service accounts → Generate new private key. Save the JSON file somewhere safe (e.g. `./scripts/firebase-service-account.json` – and add that path to `.gitignore`).

### 6. Wire things up

1. **google-services.json**  
   - Download from Console (see above).  
   - Place at project root: `./google-services.json`.  
   - In `app.json`, under `expo.android`, add:  
     `"googleServicesFile": "./google-services.json"`

2. **Service account key (FCM V1)**  
   - Generate in Console (see above).  
   - Save the JSON locally; **do not** commit it.  
   - Upload to EAS: run `eas credentials` → Android → production (or development) → Google Service Account → Manage FCM V1 → Upload the JSON file.

---

## Option B: All in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a project (or select one).
3. Add an Android app with package name: `com.kbmcollective.collectivelive`.
4. Download **google-services.json** and put it in the project root; add `expo.android.googleServicesFile` in `app.json` (see above).
5. In Project settings → **Service accounts**, click **Generate new private key**; save the JSON and add that path to `.gitignore`.
6. Upload that JSON to EAS via `eas credentials` (see above).

---

## .gitignore

Add a line so the **service account key** file is never committed, for example:

```
# Firebase service account key (secret – never commit)
**/firebase-service-account*.json
*-firebase-adminsdk-*.json
```

`google-services.json` is usually **not** ignored (Expo and Firebase docs say it’s safe to commit).

---

## After Firebase is set up

1. Add `googleServicesFile` to `app.json` (path to `google-services.json`).
2. Run `eas credentials` and upload the FCM V1 service account key for Android.
3. Build: `eas build --profile development --platform android` (or production).
4. Install the build on a real device and test push (e.g. send an announcement or use [expo.dev/notifications](https://expo.dev/notifications)).
