# Supabase setup checklist (CollectiveLive)

Use this to confirm the app and Supabase are set up correctly.

---

## 1. App config (project `.env`)

In the project root you should have a `.env` file (never commit it) with:

- `EXPO_PUBLIC_SUPABASE_URL` = your project URL, e.g. `https://xxxxxxxx.supabase.co` (no trailing slash)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = your project anon/public key

**Where to get them:** Supabase Dashboard → your project → **Settings** → **API** → Project URL and anon public key.

**Expo Go:** The app reads these via `app.config.js` → `expo.extra`. Run `npx expo start --clear` after changing `.env` so the bundle picks them up.

---

## 2. Supabase project (Dashboard)

- **Authentication** → Providers: Email (and any others you use) enabled.
- **Database** → Tables exist: `users`, `events`, `event_members`, `posts`, `likes`, `notifications`, `schedule_sessions`, etc. (see `supabase-schema.sql`).
- **Storage**: Buckets `event-photos` and `avatars` exist if you still use Supabase for some images (R2 is optional; app falls back to Storage when R2 is not configured).
- **API**: No extra config needed; the app uses the anon key and RLS.

---

## 3. Edge Function secrets (Dashboard)

Go to **Edge Functions** → **Secrets**.

**Auto-injected by Supabase (do not add manually):**  
`SUPABASE_URL`, `SUPABASE_ANON_KEY` — already available to all Edge Functions.

**You must set for R2 image uploads:**

| Secret                | Value |
|-----------------------|--------|
| `R2_ACCOUNT_ID`       | Cloudflare account ID (e.g. `aac994fdcde128cf893654b7bb405cfc`) |
| `R2_ACCESS_KEY_ID`     | R2 API token Access Key ID |
| `R2_SECRET_ACCESS_KEY`| R2 API token Secret Access Key |
| `R2_BUCKET_NAME`      | e.g. `collectivelive-images` |
| `R2_PUBLIC_URL`       | Public bucket URL (e.g. `https://pub-xxxx.r2.dev`, no trailing slash) |

If any R2 secret is missing, the app still works but new uploads use Supabase Storage instead of R2.

**Other functions** (e.g. `process-scheduled-announcements`, `notify-event-starting-soon`, `auto-deactivate-events`) may need `SUPABASE_SERVICE_ROLE_KEY` if they use the service role. Add that in Secrets if you use those features and they log “Missing SUPABASE_SERVICE_ROLE_KEY”.

---

## 4. Deploy Edge Function (R2)

After setting the R2 secrets:

```bash
npx supabase functions deploy get-r2-upload-url
```

If the CLI asks you to log in or link the project, do that first.

---

## 5. Quick verification

- **App:** Log in, open Feed — posts load (or you see a clear error like “Couldn’t load the feed” / “Request timed out”).
- **Expo Go:** If Feed stays on “Loading feed…” or times out, confirm `.env` has the correct URL and anon key and run `npx expo start --clear`. iOS/Android builds read from `app.config.js` / env at build time.
- **R2:** Post a photo or change avatar. If R2 is configured and the function is deployed, new image URLs should be like `https://pub-xxxx.r2.dev/...`. If not, the app falls back to Supabase Storage URLs.
- **Edge Function logs:** Supabase Dashboard → **Edge Functions** → **get-r2-upload-url** → **Logs**. Check for 401 (auth), 503 (R2 not configured), or 500 (e.g. wrong R2 credentials).

---

## Summary

| Item                    | Where to check |
|-------------------------|----------------|
| App Supabase URL/Key    | `.env` → `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Auth / DB / Storage     | Supabase Dashboard |
| R2 secrets              | Supabase → Edge Functions → Secrets (5 R2_* vars) |
| R2 function deployed    | `npx supabase functions deploy get-r2-upload-url` |
| SUPABASE_URL / ANON_KEY | Injected by Supabase; do not add as secrets |
