# Setup: Native App + Admin Web

Use this to confirm **both** the native app (Expo) and the admin web app are set up correctly. Both use the **same** Supabase project.

---

## 1. Native app (Expo / KBM Connect)

**Env (project root):** Copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_SUPABASE_URL` = your Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon/public key

**Verify:**

```bash
npm test
```

- TypeScript should pass, Supabase API and tables should return 200 (except optional chat_groups if not migrated).
- Run the app: `npx expo start` (or `npx expo start --web` for web).

**Docs:** `.env.example`, `SUPABASE-SETUP-CHECKLIST.md`, `EXPO-GO-SETUP.md`

---

## 2. Admin web app (admin-setup)

**Env:** In the `admin-setup/` folder, copy `.env.example` to `.env` and set the **same** Supabase values:

- `VITE_SUPABASE_URL` = same URL as `EXPO_PUBLIC_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` = same key as `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**Verify:**

```bash
cd admin-setup
npm install
npm run build
```

- Build should complete with no errors.
- Run locally: `npm run dev` → open http://localhost:5174
- Only **event admins** and **platform admins** can sign in (see `admin-setup/README.md`).

**Docs:** `admin-setup/README.md`, `admin-setup/.env.example`

---

## Quick checklist

| Item | Native app | Admin web |
|------|------------|-----------|
| .env present | Root: `EXPO_PUBLIC_SUPABASE_*` | `admin-setup/.env`: `VITE_SUPABASE_*` |
| Same Supabase project | ✓ | ✓ (same URL + anon key) |
| Verify | `npm test` | `cd admin-setup && npm run build` |
| Run | `npx expo start` | `cd admin-setup && npm run dev` |
