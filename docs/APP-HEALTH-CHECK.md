# App health check — iPhone, Android, performance

Run periodically to confirm no errors, no critical bugs, and good performance/speed on iOS and Android.

---

## 1. Automated checks (run from project root)

```bash
npm test
```

**Covers:**
- **TypeScript** — `tsc --noEmit` (no type errors)
- **App config** — EAS `projectId`, `expo-notifications` plugin
- **Supabase** — API reachable, core tables (events, users, posts, notifications, B2B, session ratings, etc.)

**Known non-blocking:** `chat_groups`, `chat_group_members`, `group_messages` may return 500 if RLS/recursion fixes not applied; other features work.

---

## 2. iOS & Android config

| Check | Status |
|-------|--------|
| **app.json** | `ios.bundleIdentifier`, `android.package`, `scheme`, permissions, splash, plugins |
| **EAS** | `eas.json` has preview + production with Supabase env; iOS/Android build types set |
| **Android** | `AndroidManifest.xml` — camera, storage, vibrate, deep link `collectivelive`; notification channel in `_layout.tsx` |
| **Push** | `NOTIFICATION_CHANNEL_ID` matches Edge Functions; channel created on Android in root layout |

No errors found in config; builds and push are correctly set for both platforms.

---

## 3. Code quality & bugs

| Area | Result |
|------|--------|
| **Linter** | No errors in `app/`, `lib/`, `components/`, `stores/` |
| **Lists** | Feed, community, notifications, chat, B2B, schedule, groups, admin lists use **FlatList** with **keyExtractor** (good for performance and stability on iOS/Android) |
| **Refs** | Optional chaining used where needed (e.g. `listRef.current?.scrollToIndex`) |
| **Error boundary** | Root layout wraps app with `ErrorBoundary` |
| **LogBox** | Harmless keep-awake warning suppressed |

**Optional improvement:** Leaderboard "Rankings" uses `ScrollView` + `map`; for events with 100+ members, consider `FlatList` for the rest list. Not a bug; only affects scroll performance at very large list sizes.

---

## 4. Performance & speed

- **Virtualized lists** — Long lists use `FlatList` with `keyExtractor`. Feed and photo-book use `initialNumToRender`, `maxToRenderPerBatch`, `windowSize`; same tuning added for community, schedule, notifications, B2B list, and groups so scroll stays smooth on iPhone and Android.
- **Memo** — `PostCard` is wrapped in `memo` to avoid unnecessary re-renders when the parent list updates.
- **Images** — Post/photo book use standard `Image` with `uri`; React Native’s default image cache applies. For very heavy feeds, consider `expo-image` later.
- **Session** — Refresh on app foreground (with delay) to avoid token race; no re-fetches on every tab switch.
- **Push token** — Registered once on sign-in/initial session (not on every token refresh).

No critical performance issues; structure is suitable for good speed on both platforms.

---

## 5. Manual test checklist

Use **docs/FULL-TEST-CHECKLIST.md** for:

- Login, logout, session persistence, registration
- Push notifications (no duplicates)
- All main pages (Home, Agenda, Feed, B2B, Community, Leaderboard, Profile)
- No red screens, no "Network request failed" with good connectivity (use tunnel if device and PC on different networks)
- Back navigation and pull-to-refresh

---

## Summary

| Category | Status |
|----------|--------|
| TypeScript & tests | ✅ Pass |
| App config (iOS/Android/EAS) | ✅ OK |
| Linter & list implementation | ✅ No errors; FlatLists with keyExtractor |
| Performance | ✅ Virtualized lists; no critical issues |
| Known issues | ⚠️ Chat group tables 500 if migrations not run (optional feature) |

**Conclusion:** App is in good shape for iPhone and Android with no blocking errors or bugs identified; performance and speed are appropriate for production use.
