# Live debugging (Expo Go or dev build)

Ways to debug the app while you use it in **Expo Go** or a **development build**.

---

## 1. In-app Debug panel (already in the app)

- **Where:** Blue **Debug** button on the Profile/Info screen (only in development).
- **What it does:**
  - Shows a **persisted log** of load events (Profile, Notifications, Groups, Feed, etc.) and errors.
  - **Test connection** — checks if the device can reach Supabase (helps with “page not loading”).
  - **Share** — copy/send the log for support or pasting into chat.
- **When to use:** After something fails (e.g. minimize/reopen, then open Profile). Open Debug and check the log + connection test.

---

## 2. Metro logs (terminal)

- **Where:** The terminal where you ran `npx expo start` (or `npx expo start --clear --tunnel`).
- **What you see:** All `console.log`, `console.warn`, `console.error` from the app.
- **Tip:** Keep that terminal visible while you use the app; errors and warnings appear there in real time.

---

## 3. Open developer menu (Expo Go or dev build)

- **Device:** Shake the phone.
- **Simulator:** `Ctrl+D` (Android), `Cmd+D` (iOS).
- **Options that help with live debugging:**
  - **Debug Remote JS** — opens Chrome DevTools so you can set breakpoints, step through JS, and inspect the console.
  - **Show Element Inspector** — tap elements on screen to see component and style info.
  - **Reload** — reload the app (e.g. after code or env changes; use `npx expo start --clear` if you changed `.env`).

---

## 4. Chrome DevTools (breakpoints + console)

1. Shake device (or `Cmd+D` / `Ctrl+D`) → tap **Debug Remote JS**.
2. Chrome opens; use the **Console** and **Sources** tabs.
3. In **Sources**, open your files (e.g. under `localhost:8081` or the path shown) and click a line number to set a **breakpoint**. When that code runs, execution will pause.
4. **Note:** Debugging over the network (e.g. tunnel) can be slow; for heavy debugging, use the same Wi‑Fi or USB and avoid tunnel if possible.

---

## 5. React DevTools (components and state)

- **Install:** `npm install -g react-devtools` (one time).
- **Run:** In a separate terminal run `react-devtools`.
- **Use:** With the app running in Expo Go (or dev build), the component tree and props/state will connect. Helps to see which component is mounted and what state it has while you use the app.

---

## 6. Network / API calls

- **Chrome DevTools:** After **Debug Remote JS**, open the **Network** tab to see fetch/XHR requests (e.g. to Supabase). Filter by “Fetch/XHR” to focus on API calls.
- **Debug panel:** Use **Test connection** to see if Supabase is reachable; the persisted log often shows “Load started” / “Load failed” / “Load timed out” for key screens.

---

## Quick checklist while testing

1. **Metro terminal** — visible so you see logs and errors.
2. **Debug panel** — open after reproducing an issue; check log + connection test.
3. **Developer menu** — use **Reload** after code or env changes; use **Debug Remote JS** when you need breakpoints or a full console.
4. **Same Wi‑Fi or tunnel** — device and computer on same network (or `npx expo start --clear --tunnel`) so the app can reach Metro and Supabase.

---

## Production builds

The **Debug** button and `__DEV__`-only logs are not shown in production. For production issues, use error reporting (e.g. Sentry, or your own logging endpoint) and build-specific logging you add for release.
