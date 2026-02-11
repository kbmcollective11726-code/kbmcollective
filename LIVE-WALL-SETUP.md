# CollectiveLive Live Wall – Setup Guide

The **live wall** is a Next.js web app that displays your event feed, schedule, leaderboard, and live activity on a big screen (TV, projector, or browser). It uses the **same Supabase project** as the mobile app and updates in real time.

---

## 1. Prerequisites

- You already have the **CollectiveLive** mobile app configured with Supabase (`.env` in the project root with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
- Node.js 18+ installed.

---

## 2. Configure environment

The live wall needs the **same** Supabase URL and anon key as the app, but with **Next.js** env names.

1. Go into the live wall folder:
   ```bash
   cd live-wall
   ```

2. Create `.env.local` (copy from the example):
   ```bash
   cp .env.local.example .env.local
   ```

3. Edit `live-wall/.env.local` and set:
   - **NEXT_PUBLIC_SUPABASE_URL** – same value as `EXPO_PUBLIC_SUPABASE_URL` in your main app `.env`
   - **NEXT_PUBLIC_SUPABASE_ANON_KEY** – same value as `EXPO_PUBLIC_SUPABASE_ANON_KEY` in your main app `.env`

   Example (use your real values from the Supabase dashboard):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

   You can copy these from the root `.env`; only the variable names differ (`NEXT_PUBLIC_*` vs `EXPO_PUBLIC_*`).

---

## 3. Install and run

```bash
cd live-wall
npm install
npm run dev
```

Then open: **http://localhost:3000**

- On the first page you’ll see **active events** from your Supabase project.
- Click an event to open the **wall** for that event (feed, schedule, leaderboard, live comments, ticker).

---

## 4. Using the wall

- **Home (/)**: List of active events → choose one.
- **Wall (/wall?event=EVENT_ID)**:  
  - Featured photo (rotates every 15s).  
  - Stats: photos, likes, comments, participants.  
  - Happening now / Up next (from schedule).  
  - Top performers (leaderboard).  
  - Live activity (recent comments).  
  - Bottom ticker with messages and leader name.

Everything updates in real time via Supabase Realtime (new posts, likes, comments, leaderboard).

---

## 5. Opening the wall from the mobile app

In the app’s **hamburger menu** you can add a “Live wall” link that opens this page in the browser.

- **Local**: Set in the main app `.env`:
  ```
  EXPO_PUBLIC_LIVE_WALL_URL=http://localhost:3000
  ```
  (Only useful when testing on the same machine or when the phone can reach your computer’s IP, e.g. `http://192.168.1.x:3000`.)

- **Deployed**: Deploy the live wall (e.g. [Vercel](https://vercel.com)) and set:
  ```
  EXPO_PUBLIC_LIVE_WALL_URL=https://your-wall.vercel.app
  ```
  Then the app can open the wall URL in the device browser.

---

## 5a. Showing the wall on a big screen (laptop)

To display the live wall on a TV or projector using your laptop:

1. **Connect the laptop to the big screen**
   - Use **HDMI** (or USB-C/DisplayPort adapter) from the laptop to the TV/projector.
   - Turn on the TV/projector and select the correct input (HDMI 1, etc.).
   - In Windows: **Win + P** → choose **Duplicate** (same on both) or **Extend** (TV as second screen). On Mac: **System Settings → Displays** and arrange as you like.

2. **Open the live wall in a browser**
   - On the laptop, open Chrome, Edge, or Firefox and go to:
   - **https://live-wall-six.vercel.app** (or your deployed URL).
   - Select the event (or go straight to the wall if you have a bookmark with `?event=...`).

3. **Go fullscreen**
   - **Windows:** Press **F11** to toggle fullscreen (hides address bar and tabs).
   - **Mac:** **Ctrl + Cmd + F** (or View → Enter Full Screen).
   - The big screen will show the wall in fullscreen (either mirrored from the laptop or as the extended display).

4. **Optional: use the TV as the only output**
   - **Extend** the display, then drag the browser window to the TV and fullscreen it there. You can keep using the laptop screen for other things (e.g. running the event, moderating).

5. **Optional: kiosk-style (Chrome, no browser UI)**
   - Windows: Create a shortcut or run:
     ```text
     "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=https://live-wall-six.vercel.app/wall?event=YOUR_EVENT_ID
     ```
   - Replace `YOUR_EVENT_ID` with the event UUID. Chrome opens in a window with no address bar or tabs; fullscreen that window (F11) on the TV.

**Summary:** Laptop → HDMI → TV. Open the wall URL in the browser, select the event, press F11. The big screen shows the live wall.

---

## 6. Deploying the live wall (Vercel)

### Option A: Vercel CLI

1. **Install the CLI** (one-time):
   ```bash
   npm i -g vercel
   ```

2. **Log in** (one-time):
   ```bash
   vercel login
   ```
   Follow the prompts (email or GitHub).

3. **Deploy from the live-wall folder**:
   ```bash
   cd live-wall
   vercel
   ```
   - First run: it will ask “Set up and deploy?” → **Y**.
   - “Which scope?” → pick your account.
   - “Link to existing project?” → **N** (or Y if you already created one).
   - “What’s your project’s name?” → e.g. `collectivelive-wall` or accept the default.
   - “In which directory is your code located?” → **./** (you’re already in `live-wall`).
   - It will build and give you a URL like `https://collectivelive-wall-xxx.vercel.app`.

4. **Add env vars** (required for Supabase):
   ```bash
   vercel env add NEXT_PUBLIC_SUPABASE_URL
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```
   Paste your values when prompted. Then redeploy so they take effect:
   ```bash
   vercel --prod
   ```

5. **Use the URL** in the app: set in the main app `.env`:
   ```
   EXPO_PUBLIC_LIVE_WALL_URL=https://your-project.vercel.app
   ```
   (Use the URL from `vercel --prod` or from the Vercel dashboard.)

**Later:** from `live-wall`, run `vercel` or `vercel --prod` to deploy again.

### Option B: Vercel Dashboard

1. Push your repo (with `live-wall/.env.local` **not** committed).
2. In [Vercel](https://vercel.com): New Project → Import your repo.
3. Set **Root Directory** to `live-wall`.
4. Add **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Deploy. Use the generated URL as `EXPO_PUBLIC_LIVE_WALL_URL` in the app.

---

## 7. Troubleshooting

| Issue | What to check |
|-------|----------------|
| “No active events” | Ensure `.env.local` has the correct Supabase URL and anon key. In Supabase, ensure you have at least one event with `is_active = true`. |
| Blank or “Loading…” forever | Open the browser dev tools (F12) → Console/Network. Check for CORS or failed requests to Supabase. Confirm RLS allows read access for the anon key on `events`, `posts`, `schedule_sessions`, `event_members`, `comments`. |
| Leaderboard empty | The wall reads `event_members` (with `points`) and `users`. Ensure your schema has points populated (e.g. from `point_log` or a view). |
| Realtime not updating | In Supabase Dashboard → Project Settings → API, ensure “Realtime” is enabled. Tables `posts`, `likes`, `comments`, `event_members` must have Realtime enabled in Database → Replication. |

---

## Summary

1. Copy Supabase URL and anon key from the main app into `live-wall/.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.  
2. Run `cd live-wall && npm install && npm run dev` and open http://localhost:3000.  
3. Select an event and use the wall; optionally deploy and set `EXPO_PUBLIC_LIVE_WALL_URL` in the app.
