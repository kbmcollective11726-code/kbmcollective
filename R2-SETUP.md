# Cloudflare R2 setup (images off Supabase = less egress)

New uploads (post images, avatars, event banners) try **R2 first**; if R2 isn’t configured, they fall back to Supabase Storage. No app env vars needed; configuration is in Supabase Edge Function secrets.

---

## 1. Create R2 bucket and API token (Cloudflare)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2** (left sidebar) → **Create bucket**.
2. Name it (e.g. `collectivelive-images`).
3. **Public access**: enable “Allow public access” and note the **Public bucket URL** (e.g. `https://pub-xxxx.r2.dev`). This is your **R2_PUBLIC_URL**.
4. **R2 API token** (created on the **R2 overview** page, not inside a bucket):
   - Go to **R2** in the sidebar so you see the list of buckets (Overview).
   - On that page, click **Manage R2 API Tokens** (top right or in the right-hand panel).
   - **Create API token** → name it (e.g. `collectivelive-uploads`), permission **Object Read & Write**, scope to your bucket or “All buckets”.
   - After creating, copy **Access Key ID** → `R2_ACCESS_KEY_ID` and **Secret Access Key** → `R2_SECRET_ACCESS_KEY` (secret is shown only once).
5. **Account ID**: on the R2 overview page, copy **Account ID** from the right sidebar → `R2_ACCOUNT_ID`.
6. **Bucket name**: the name you gave (e.g. `collectivelive-images`) → `R2_BUCKET_NAME`.

---

## 2. Set Supabase secrets and deploy (CLI)

From the project root, after creating the R2 API token in Cloudflare:

```bash
node scripts/setup-r2-supabase.mjs
```

The script will prompt for each value (or use env vars below). It sets the five Supabase Edge Function secrets and deploys `get-r2-upload-url`.

**Or** set env vars and run without prompts (PowerShell):

```powershell
$env:R2_ACCOUNT_ID="aac994fdcde128cf893654b7bb405cfc"
$env:R2_ACCESS_KEY_ID="your-access-key-id"
$env:R2_SECRET_ACCESS_KEY="your-secret-access-key"
$env:R2_BUCKET_NAME="collectivelive-images"
$env:R2_PUBLIC_URL="https://pub-d1210b28e4ce468a898decd45c5e7820.r2.dev"
node scripts/setup-r2-supabase.mjs
```

**Manual alternative:** [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Edge Functions** → **Secrets**, add:

| Secret name           | Value                                      |
|-----------------------|--------------------------------------------|
| `R2_ACCOUNT_ID`       | Your Cloudflare account ID                 |
| `R2_ACCESS_KEY_ID`    | R2 API token Access Key ID                 |
| `R2_SECRET_ACCESS_KEY`| R2 API token Secret Access Key             |
| `R2_BUCKET_NAME`      | Your R2 bucket name                        |
| `R2_PUBLIC_URL`       | Public bucket URL (e.g. `https://pub-xxx.r2.dev`) |

No trailing slash on `R2_PUBLIC_URL`. Then deploy: `npx supabase functions deploy get-r2-upload-url`.

---

## 3. Verify

- Post a photo, change avatar, or upload an event banner.
- If R2 is configured and the function is deployed, new images will have URLs like `https://pub-xxxx.r2.dev/event-photos/...` (or your custom domain).
- Existing Supabase Storage image URLs keep working; only **new** uploads use R2 when it’s set up.

---

## Summary

- **App**: No `.env` changes. It calls the Edge Function; the function uses R2 secrets.
- **Auth, DB, notifications, realtime**: All stay on Supabase.
- **Image bytes**: New uploads go to R2 (zero egress cost), so Supabase egress stays low.
