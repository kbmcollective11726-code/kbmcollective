# Deploy Admin Desktop to Vercel

**Full step-by-step:** see **VERCEL-SETUP-CHECKLIST.md** in this folder.

---

## Quick setup (CLI + env from local .env)

1. **Log in:** `npx vercel login`
2. **Push env vars** from your project root `.env` (or `admin-setup/.env`) to Vercel:
   ```bash
   cd admin-setup
   npm run vercel:env
   ```
   This sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview.
3. **Deploy:**
   ```bash
   npx vercel --prod
   ```
   Your app will be at the URL Vercel prints (e.g. `https://admin-setup-omega.vercel.app`).

**If you link a repo:** In Vercel project settings, set **Root Directory** to **`admin-setup`** so the build uses this app.

---

## Manual setup (Vercel dashboard)

### 1. Create a Vercel project

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Import the repo; set **Root Directory** to **`admin-setup`** (required).
3. Build uses `vercel.json`: `npm run build`, output `dist`.

### 2. Environment variables

In **Settings** → **Environment Variables** add:

| Name                     | Value                     | Environments   |
|--------------------------|---------------------------|----------------|
| `VITE_SUPABASE_URL`      | Your Supabase project URL | Production, Preview |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key    | Production, Preview |

Same values as in the main app `.env` (e.g. `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`). See `.env.vercel.example` for reference.

### 3. Deploy

Deploy from the dashboard or run `npx vercel --prod` from `admin-setup`. Open the deployment URL and sign in with your admin account.

### 4. Optional: custom domain

**Settings** → **Domains** to add e.g. `admin.yourdomain.com`.

---

## Config reference

- **`vercel.json`** – build command, output dir, SPA rewrites.
- **`scripts/vercel-env-push.mjs`** – syncs Supabase vars from local `.env` to Vercel (run `npm run vercel:env`).
- **`.env.vercel.example`** – list of vars to set in Vercel.
