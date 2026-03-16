# Testing in Expo Go — Setup so pages load

Expo Go loads the app bundle from your computer. The Supabase URL and key must be **baked into the bundle** when you start the server. Follow these steps so Feed, Info, Agenda, and other pages load.

---

## 1. Create `.env` in project root

In the **same folder** as `app.config.js` and `package.json`, create a file named `.env` (no extension) with:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

- Get both from **Supabase Dashboard** → your project → **Settings** → **API** (Project URL and anon public key).
- No quotes needed unless the value contains spaces.
- No trailing slash on the URL.

---

## 2. Start Expo with a clean cache

From the **project root** (where `package.json` lives), run:

```bash
npx expo start --clear
```

- **`--clear`** forces Metro to re-read `.env` and rebuild the config. If you don’t use it after adding or changing `.env`, Expo Go may still get old (or empty) config and pages won’t load.
- Leave this terminal open; don’t start Expo from a different folder.

---

## 3. Open the app in Expo Go

- Scan the QR code with your phone (Expo Go app).
- **Same Wi‑Fi:** Phone and computer must be on the same Wi‑Fi so the device can load the bundle.
- **Different network?** Use tunnel: `npx expo start --clear --tunnel` (slower but works across networks).

---

## 4. If you see “Expo Go: Supabase not loaded”

That means the bundle didn’t get your Supabase URL/key. Do this:

1. Stop the Expo server (Ctrl+C in the terminal).
2. Confirm `.env` exists in the project root and has `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. From project root, run again: `npx expo start --clear`.
4. In Expo Go, **close the app completely** and reopen it (or shake → Reload).

---

## 5. If pages stay on “Loading…” or “Couldn’t load the feed”

- **Config is OK** (you’re past the “Supabase not loaded” screen) but **requests are failing**:
  - **Network:** Phone and computer on the **same Wi‑Fi**, or run `npx expo start --clear --tunnel`.
  - **Retry:** Wait ~15s for the timeout, then tap “Try again” or pull down to refresh.
  - **Supabase limits:** If you were over the free tier egress, upgrading to Pro/NANO and waiting for usage to reset should fix it.

---

## 6. Test if your device can reach Supabase

On the **same phone** you use for Expo Go, open the **browser** and go to:

`https://YOUR_PROJECT_REF.supabase.co/rest/v1/`

(Use your real project ref, e.g. `https://noydhokbswedvltjyenr.supabase.co/rest/v1/`)

- If you see a **401 Unauthorized** or a short JSON response → the device **can** reach Supabase; the app issue is likely config or session. Run `npx expo start --clear`, reload the app, and try again.
- If the page **doesn’t load** or times out → the device **cannot** reach Supabase (different network, firewall, or VPN). Use the same Wi‑Fi as your computer or run Expo with `--tunnel`.

---

## Quick checklist

| Step | Check |
|------|--------|
| 1 | `.env` in project root with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| 2 | Run `npx expo start --clear` from project root (not a subfolder) |
| 3 | Phone and computer on same Wi‑Fi (or use `--tunnel`) |
| 4 | Open app in Expo Go after the server is running; reload if you changed .env |

After this, Feed, Info, Agenda, Community, Rank, and Profile should load in Expo Go as long as Supabase is under its limits and the network is stable.
