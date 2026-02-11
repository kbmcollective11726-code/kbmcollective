# CollectiveLive — Complete Build Guide for Cursor AI

## BEFORE YOU OPEN CURSOR — Do These First (30 minutes)

### Step 1: Install Required Tools
Open your terminal (Mac Terminal or Windows PowerShell) and run these:

```bash
# Install Node.js (if you don't have it)
# Download from: https://nodejs.org (use the LTS version)

# Verify Node is installed
node --version   # Should show v18 or higher

# Install Expo CLI globally
npm install -g expo-cli eas-cli

# Verify Expo
npx expo --version
```

### Step 2: Create Your Supabase Project (FREE)
1. Go to https://supabase.com → Sign up with GitHub
2. Click "New Project"
3. Name: `collectivelive`
4. Database password: SAVE THIS — you'll need it
5. Region: Pick the closest to where your events happen (US East for Florida)
6. Click "Create new project" — wait 2 minutes for it to spin up
7. Once ready, go to **Settings → API** and copy these two values:
   - `Project URL` (looks like: https://xxxx.supabase.co)
   - `anon/public` key (long string starting with `eyJ...`)
8. Save both somewhere safe — you'll paste them into the app

### Step 3: Set Up the Database
1. In Supabase, go to **SQL Editor** (left sidebar)
2. Click "New query"
3. Copy the ENTIRE contents of the `supabase-schema.sql` file from this starter kit
4. Paste it into the SQL editor
5. Click "Run" — this creates all your tables, security policies, and storage buckets

### Step 3b: Create a Test Event (so you can use the app)
1. In Supabase, go to **SQL Editor** again
2. Click "New query"
3. Copy the ENTIRE contents of `scripts/seed-event.sql` from this project
4. Paste into the SQL editor and click **Run**
5. This creates one event ("CollectiveLive Demo Event") and all point rules
6. **Schedule**: Either run **scripts/seed-schedule.sql** in the SQL Editor (adds demo sessions), or in the app: make yourself an event admin (e.g. in Supabase set your user as admin in `event_members`), then **Profile → Event admin → Manage schedule** to add sessions.
7. In the app: open **Info** tab → tap **Event** → tap "CollectiveLive Demo Event" to join. Then use **Feed**, **Post**, **Schedule**, and **Leaderboard** to test.

**If you see "Failed to load events" in the app:**
- Run **supabase-schema.sql** first in the **same** project (Dashboard → SQL Editor → New query → paste full schema → Run). That creates the `events` table and policies.
- Then run **scripts/seed-event.sql** again in the same project.
- In Supabase: **Table Editor** → **events** — you should see at least one row.
- Restart the app: `npx expo start --clear`, then pull to refresh on the Info screen. The red error may show the real message (e.g. "relation public.events does not exist" = schema not run).

### Step 4: Create Apple & Google Developer Accounts
- **Apple**: https://developer.apple.com → Enroll ($99/year) — needed for iOS
- **Google Play**: https://play.google.com/console → Register ($25 one-time) — needed for Android
- You can start building without these but need them before publishing

### Remote testing (someone not on your WiFi)
To let someone **off your network** (e.g. a friend or client) test the app:

1. **On your machine** (with the project open), run:
   ```bash
   npm run tunnel
   ```
   or: `npx expo start --tunnel`
2. Wait for the tunnel URL (e.g. `exp://u.expo.dev/...`). A **QR code** will appear in the terminal.
3. **Send the tester:**
   - **Option A:** The QR code (screenshot or share the terminal). They open **Expo Go** on their phone and scan it.
   - **Option B:** The project URL shown in the terminal (e.g. `https://expo.dev/...`). On their phone they open that link; it can open in Expo Go or the browser and prompt to open in Expo Go.
4. **Tester:** Install **Expo Go** from the App Store (iOS) or Google Play (Android) if they don’t have it, then scan the QR code or open the link.
5. Keep your dev server running and the tunnel active while they test. The app talks to **Supabase in the cloud**, so they don’t need to be on your WiFi.

**Notes:** The first time you run `--tunnel`, Expo may install or use a tunneling tool (e.g. ngrok). If the QR doesn’t work, try opening the `exp://` or `https://expo.dev/...` URL directly on the tester’s device.

### What's in the app (and what might still be missing)
- **Implemented:** Auth (login/register), **event join by code** (users enter event code on Info tab to search and join), summit-style **Info page** (admin-editable: welcome hero, event details, what to expect, points section), feed (posts, like, comment), camera/post, schedule (view + bookmark), leaderboard, profile (edit, people, notifications, DMs), admin (edit event, **Edit info page**, manage schedule, members, moderate posts, announcements), push token registration, live wall (Next.js: feed/schedule/leaderboard + ticker), deep link stub, error boundary.
- **Event code:** When an event is created (in Supabase or via seed), it gets a unique **event_code** (e.g. `ABC123`). Share this code with attendees; they enter it on the Info tab to find and join the event. Admins can see/copy the code in **Profile → Event admin → Edit info page**.
- **Existing database:** If you already ran the full schema before, run **scripts/migrate-event-code-and-info-page.sql** in the Supabase SQL Editor to add `event_code` and info-page fields and backfill codes. Then run **scripts/migrate-admin-create-events.sql** so admins (and any logged-in user) can create new events from the app.
- **Schedule:** If the Schedule tab is empty, add sessions via **Profile → Event admin → Manage schedule** (you must be an admin for that event), or run **scripts/seed-schedule.sql** in Supabase.
- **Schema but no UI yet:** Point rules (editable only in DB), vendor booths, meeting slots/bookings, LinkedIn/connections. You can add admin screens for these later.

---

## CREATE THE EXPO PROJECT (or use this workspace)

**If you're already in the CollectiveLive folder** (starter kit + Expo app structure is in place): skip creating a new project. Just run:

```bash
cd path/to/CollectiveLive
npm install
```

Then add your Supabase URL and anon key to `lib/supabase.ts`, run `supabase-schema.sql` in Supabase SQL Editor, and run `npx expo start`.

---

**If you're starting from scratch**, open your terminal and run:

```bash
# Create the project
npx create-expo-app@latest collectivelive --template blank-typescript

# Go into the project folder
cd collectivelive

# Install all required packages
npx expo install expo-router expo-constants expo-linking expo-status-bar expo-splash-screen react-native-safe-area-context react-native-screens react-native-gesture-handler react-native-reanimated

# Navigation
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack

# Supabase
npm install @supabase/supabase-js react-native-url-polyfill @react-native-async-storage/async-storage

# Camera & Photos
npx expo install expo-camera expo-image-picker expo-image-manipulator expo-file-system

# Push Notifications
npx expo install expo-notifications expo-device

# Other essentials
npx expo install expo-barcode-scanner expo-haptics expo-linear-gradient
npm install react-native-toast-message date-fns zustand
npm install lucide-react-native react-native-svg
```

---

## OPEN IN CURSOR AI

```bash
# Open the project in Cursor
cursor .
```

Or: Open Cursor → File → Open Folder → select the `CollectiveLive` folder

---

## PROJECT STRUCTURE TO CREATE

Tell Cursor: "Create this folder structure for me"

```
CollectiveLive/
├── app/                          # Expo Router screens (file-based routing)
│   ├── _layout.tsx               # Root layout with auth check
│   ├── index.tsx                 # Entry point → redirects to auth or home
│   ├── (auth)/                   # Auth screens (no tab bar)
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── onboarding.tsx
│   ├── (tabs)/                   # Main app screens (with tab bar)
│   │   ├── _layout.tsx           # Tab bar configuration
│   │   ├── home.tsx              # Event info / home screen
│   │   ├── feed.tsx              # Photo feed (Instagram-style)
│   │   ├── camera.tsx            # Take/upload photo (center tab)
│   │   ├── schedule.tsx          # Event agenda
│   │   └── profile.tsx           # User profile
│   ├── post/[id].tsx             # Single post detail
│   ├── chat/[userId].tsx         # DM conversation
│   ├── people/index.tsx          # Attendee directory
│   ├── leaderboard/index.tsx     # Points leaderboard
│   ├── notifications/index.tsx   # Notification center
│   └── admin/                    # Admin screens
│       ├── index.tsx
│       ├── events.tsx
│       ├── schedule-editor.tsx
│       ├── announcements.tsx
│       └── moderation.tsx
├── components/                   # Reusable UI components
│   ├── PostCard.tsx              # Single post in feed
│   ├── CommentSheet.tsx          # Bottom sheet for comments
│   ├── LeaderboardRow.tsx        # Leaderboard entry
│   ├── ScheduleCard.tsx          # Schedule session card
│   ├── PersonCard.tsx            # User card in directory
│   ├── PhotoGrid.tsx             # Photo album grid
│   ├── NotificationItem.tsx      # Single notification
│   ├── Header.tsx                # Screen header
│   ├── Button.tsx                # Styled button
│   ├── Avatar.tsx                # User avatar
│   └── EmptyState.tsx            # Empty state placeholder
├── lib/                          # Core utilities
│   ├── supabase.ts               # Supabase client setup
│   ├── auth.ts                   # Auth helper functions
│   ├── notifications.ts          # Push notification setup
│   ├── points.ts                 # Gamification logic
│   ├── image.ts                  # Photo compression & upload
│   └── types.ts                  # TypeScript type definitions
├── stores/                       # State management (Zustand)
│   ├── authStore.ts              # User session state
│   ├── eventStore.ts             # Current event state
│   ├── feedStore.ts              # Feed posts state
│   └── notificationStore.ts     # Notifications state
├── constants/                    # App constants
│   ├── colors.ts                 # Color theme
│   ├── points.ts                 # Point values
│   └── config.ts                 # App configuration
├── assets/                       # Static assets
│   ├── icon.png                  # App icon (1024x1024)
│   ├── splash.png                # Splash screen
│   └── adaptive-icon.png         # Android adaptive icon
├── app.json                      # Expo config
├── tsconfig.json                 # TypeScript config
├── .cursorrules                  # Cursor AI instructions
└── supabase-schema.sql           # Database schema
```

---

## BUILD ORDER — Follow This Sequence

### Phase 1: Foundation (Days 1-3)
Tell Cursor AI these prompts in order:

**Prompt 1 — Supabase Connection:**
> "Set up the Supabase client in lib/supabase.ts. Use @supabase/supabase-js with AsyncStorage for session persistence. My Supabase URL is [YOUR_URL] and anon key is [YOUR_KEY]. Include auth state listener."

**Prompt 2 — Auth Store:**
> "Create a Zustand auth store in stores/authStore.ts that manages user session, login with email/password, register with email/password/name, logout, and tracks loading states. Use the Supabase client from lib/supabase.ts."

**Prompt 3 — Auth Screens:**
> "Build the login and register screens in app/(auth)/. Clean, modern design with email and password fields. Use the authStore for login/register actions. After successful auth, navigate to the main tabs. Include a toggle to switch between login and register."

**Prompt 4 — Tab Layout:**
> "Create the tab bar layout in app/(tabs)/_layout.tsx with 5 tabs: Home, Feed, Camera (center, larger), Schedule, Profile. Use icons from lucide-react-native. The camera tab should be a raised circular button. Use a clean dark or light theme."

**Prompt 5 — Root Layout with Auth Guard:**
> "Create app/_layout.tsx that checks if the user is authenticated using authStore. If not authenticated, show the auth screens. If authenticated, show the main tabs. Include a splash screen while checking auth state."

**TEST: At this point, you should be able to run `npx expo start`, scan the QR code with Expo Go on your phone, and see the login/register screen. Create an account and see the tab bar.**

---

### Phase 2: Core Features (Days 4-10)

**Prompt 6 — Event Store & Home Screen:**
> "Create an event store that fetches events from Supabase 'events' table. The home screen should show current event info — name, description, location, dates, banner image. If the user is registered for multiple events, show an event picker at the top."

**Prompt 7 — Photo Upload:**
> "Create lib/image.ts with a function that: 1) opens expo-image-picker to select or take a photo, 2) compresses it with expo-image-manipulator to max 1920px wide at 80% quality, 3) uploads to Supabase Storage bucket 'event-photos' in path /{eventId}/{userId}_{timestamp}.jpg, 4) returns the public URL. Handle errors and loading state."

**Prompt 8 — Feed Screen:**
> "Build the feed screen that shows posts from the current event. Each post shows: user avatar, name, photo, caption, like count, comment count, time ago. Pull-to-refresh. Infinite scroll pagination. Like button that toggles. Tap to view comments. Uses Supabase real-time subscription to show new posts automatically at the top."

**Prompt 9 — Camera/Post Screen:**
> "Build the camera tab screen. Tap to take a photo or select from gallery using the image utility. Show preview, add caption text field, and 'Share' button. On share: upload image, create post in Supabase, award points, navigate to feed. Show upload progress."

**Prompt 10 — Comments:**
> "Create a bottom sheet component for comments. When tapping comments on a post, slide up a sheet showing all comments with user avatars and names. Text input at bottom to add a comment. Award points when commenting. Real-time updates."

**Prompt 11 — Schedule Screen:**
> "Build the schedule screen with day tabs at the top. Each day shows sessions sorted by time. Each session card shows: time, title, speaker, room/location, type badge (keynote/breakout/workshop). Tap to expand and see full description. 'Add to My Schedule' bookmark button."

**Prompt 12 — Leaderboard:**
> "Build the leaderboard screen. Shows top users ranked by points for the current event. Each row: rank number, avatar, name, points with animated counter. Top 3 get gold/silver/bronze styling. Pull-to-refresh. Include a 'Your Rank' sticky bar at the bottom showing the current user's position."

---

### Phase 3: Social Features (Days 11-16)

**Prompt 13 — People/Directory:**
> "Build the people directory screen. Grid or list of attendees at the current event. Each card shows avatar, name, title, company. Search bar to filter. Tap to view full profile. 'Connect' button that links to their LinkedIn URL. 'Message' button to start a DM."

**Prompt 14 — User Profile:**
> "Build the profile screen. Shows user's avatar (tap to change), full name, title, company, LinkedIn URL, bio. Edit button to update fields. Shows their posts in a grid below. Shows their points and badges. QR code generated from their profile URL that others can scan to connect."

**Prompt 15 — Direct Messages:**
> "Build the DM system. Messages screen shows conversation list — each row shows other user's avatar, name, last message preview, time, unread badge. Tap to open conversation. Real-time messaging using Supabase subscriptions on the messages table. Text input with send button. Messages show sent/delivered state."

**Prompt 16 — Push Notifications:**
> "Set up push notifications using expo-notifications. On app launch, request permission, get the ExpoPushToken, save it to the user's record in Supabase. Create a Supabase Edge Function that sends push notifications via Expo's push API. Trigger notifications for: likes on your posts, new comments, new DMs, admin announcements, points milestones."

**Prompt 17 — Notifications Screen:**
> "Build the notifications screen. Shows all notifications grouped by today/earlier. Each notification has an icon, message, time ago, and read/unread state. Tap to navigate to the relevant screen (the post, the message, the leaderboard, etc). Bell icon in header with unread count badge."

---

### Phase 4: Admin & Polish (Days 17-22)

**Prompt 18 — Admin Panel:**
> "Build admin screens accessible only to users with admin role. Dashboard shows event stats (attendees, posts, engagement). Schedule editor to add/edit/delete sessions. Announcement sender with push notification option. Post moderation — approve/hide/delete posts. User management — change roles, remove users."

**Prompt 19 — Points System:**
> "Implement the full gamification system. Create lib/points.ts that awards points for actions: post photo (+25), receive like (+5), comment (+10), receive comment (+5), connect with someone (+15), attend session (+20), complete profile (+30), daily streak (+15). Log all points to point_log table. Check for and prevent duplicate awards. Update event_members.points total."

**Prompt 20 — Polish & Animations:**
> "Add polish throughout the app: pull-to-refresh with haptic feedback, skeleton loading screens while data loads, animated transitions between screens, confetti animation when reaching leaderboard milestones, smooth image loading with blur placeholder, toast notifications for actions (liked, posted, points earned). Use react-native-reanimated for smooth 60fps animations."

---

## TESTING ON YOUR PHONE

Throughout the entire build:

```bash
# Start the dev server
npx expo start

# Scan the QR code with:
# - iPhone: Camera app
# - Android: Expo Go app

# The app loads on your phone instantly
# Changes you make in Cursor appear in ~2 seconds
```

---

## BUILDING FOR APP STORE (When Ready)

```bash
# Login to Expo
eas login

# Configure builds
eas build:configure

# Build for iOS (submits to Apple)
eas build --platform ios

# Build for Android (creates APK/AAB)
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

---

## LIVE WALL (Separate Project)

After the mobile app is working, create the live wall:

```bash
# Create Next.js project for the live wall
npx create-next-app@latest collectivelive-wall --typescript --tailwind

# Install Supabase
npm install @supabase/supabase-js

# Build pages:
# / — Event selector
# /wall/[eventId] — Live display with auto-rotating modes
# /leaderboard/[eventId] — Standalone leaderboard view
```

The live wall connects to the same Supabase project and uses real-time subscriptions to update automatically.

---

## CURSOR AI TIPS

1. **Be specific in prompts** — include file paths, component names, and which libraries to use
2. **Build one feature at a time** — test it works before moving to the next prompt
3. **Reference existing files** — say "use the Supabase client from lib/supabase.ts" so Cursor uses your setup
4. **If something breaks** — tell Cursor "This error appeared: [paste error]. Fix it." It's great at debugging
5. **Use the .cursorrules file** — it tells Cursor about your project conventions (included in this starter kit)
6. **Composer mode (Cmd+I)** — use this for multi-file changes. Regular chat for single-file work.

---

## TIMELINE SUMMARY

| Phase | What | Days |
|-------|------|------|
| Setup | Supabase + Expo project + auth | Days 1-3 |
| Core | Feed, camera, schedule, leaderboard | Days 4-10 |
| Social | People, DMs, notifications, profiles | Days 11-16 |
| Admin | Admin panel, points system, polish | Days 17-22 |
| Live Wall | Next.js display app | Days 23-26 |
| Testing | Bug fixes, performance, real device testing | Days 27-30 |
| Submit | App Store + Google Play submission | Days 31-35 |

**Total: ~5 weeks full-time or ~10 weeks at nights/weekends**
