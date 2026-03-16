# Vercel setup checklist — Admin web app

Use this to make sure **everything** is set up in Vercel so admins can log in and see B2B + session feedback.

---

## 1. Create / link the Vercel project

- Go to [vercel.com](https://vercel.com) → **Add New** → **Project** (or use an existing project).
- **Import** your Git repository (e.g. CollectiveLiveg).
- **Important:** Set **Root Directory** to **`admin-setup`**.
  - Click **Edit** next to “Root Directory” → enter `admin-setup` → **Save**.
- Leave **Framework Preset** as Vite (or auto-detected). Build settings come from `vercel.json`.

---

## 2. Environment variables (required)

Without these, the app will show “Configuration missing” and login won’t work.

In **Settings** → **Environment Variables** add:

| Name | Value | Environments |
|------|--------|--------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) | Production, Preview |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key | Production, Preview |

Use the **same** values as in your main app `.env` (`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`).

- Get them from: **Supabase Dashboard** → your project → **Settings** → **API** (Project URL and anon public key).

**Optional — push from local .env:**

```bash
cd admin-setup
npm run vercel:env
```

This reads from project root `.env` or `admin-setup/.env` and sets the two variables for Production and Preview.

---

## 3. Deploy

- Click **Deploy** (or push to your connected branch). Vercel will run:
  - `npm install`
  - `npm run build`
- Output is in **`dist`** (set in `vercel.json`).
- After deploy, open the deployment URL (e.g. `https://your-project.vercel.app`).

---

## 4. Verify

- [ ] Open the Vercel URL → you see the **Admin** login page (not “Configuration missing”).
- [ ] Log in with an **event admin** or **platform admin** account (same as in the mobile app).
- [ ] You land on **Events**; click an event.
- [ ] You see **B2B meeting feedback** and **Session feedback** cards; open each and confirm data loads (or “No … yet” if empty).

---

## Quick reference

| Item | Value |
|------|--------|
| Root Directory | `admin-setup` |
| Build Command | `npm run build` (from vercel.json) |
| Output Directory | `dist` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

After changing env vars, **redeploy** (Deployments → … → Redeploy) so the new values are used at build time.
