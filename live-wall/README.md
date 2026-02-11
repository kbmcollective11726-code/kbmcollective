# CollectiveLive Live Wall

Next.js app for displaying the event feed, schedule, leaderboard, and live activity on a big screen (TV or projector). Uses the same Supabase project as the mobile app and updates in real time.

## Quick setup

1. **Environment**  
   Copy `.env.local.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL` – your Supabase project URL (same as in the main app)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` – your Supabase anon key (same as in the main app)

   Use the same values as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from the main CollectiveLive `.env`.

2. **Install and run**
   ```bash
   npm install
   npm run dev
   ```

3. **Open** [http://localhost:3000](http://localhost:3000) → select an event → view the wall.

## Full guide

See **[LIVE-WALL-SETUP.md](../LIVE-WALL-SETUP.md)** in the project root for:
- Step-by-step setup
- Using the wall (featured post, stats, schedule, leaderboard, live activity)
- Opening the wall from the mobile app
- Deploying (e.g. Vercel)
- Troubleshooting

## Scripts

- `npm run dev` – development server (default port 3000)
- `npm run build` – production build
- `npm run start` – run production build
