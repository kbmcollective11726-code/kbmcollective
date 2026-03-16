# KBM Connect Admin — Event Setup

Desktop-focused web app for event admins to set up events faster: create/edit events, **batch import schedule** from CSV, and **batch add members** from CSV. Uses the same Supabase project as the main KBM Connect app.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as the main Expo app).
3. Install and run:

```bash
npm install
npm run dev
```

Open http://localhost:5174 (port 5174 to avoid clashing with the main app).

## Deploy (e.g. Vercel)

- Build command: `npm run build`
- Output directory: `dist`
- Add env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Features

- **Sign in** with the same admin account as the mobile app.
- **Events list**: Events you admin (or all events if platform admin).
- **Create event** (platform admins only): Name, dates, event code, theme. Default point rules are created automatically.
- **Edit event**: Update name, dates, location, venue, event code, theme.
- **Schedule**: List sessions; **Import CSV (batch)** — CSV with columns `title, description, speaker_name, speaker_title, speaker_company, location, room, start_date, start_time, end_date, end_time, session_type`. One row per session. Use "Download template" to get a sample.
- **Members**: List members; **Add from CSV (batch)** — CSV with `email` and optional `role` (attendee, speaker, vendor, admin). Looks up users by email and adds them to the event. Users not in the app are skipped.

Theme follows [KBM Collective](https://kbmcollective.org/) (dark header, clean layout).
