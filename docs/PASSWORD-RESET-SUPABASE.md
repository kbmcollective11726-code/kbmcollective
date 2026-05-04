# Password reset: in-app flow, HTTPS bridge, Supabase checklist

## MCP / API note

Supabase **Management MCP** (and SQL) **cannot** change **Auth URL Configuration**, **SMTP “From” name**, or **email templates**. Those are edited in the **Supabase Dashboard**.

Linked project (from MCP): **`https://noydhokbswedvltjyenr.supabase.co`**

---

## Goal: user sets password **in the app**, not in localhost

1. User taps **Reset password (email link)** in Profile (or Forgot password on login).
2. Email contains a link that first opens a **real HTTPS** page (your deployed admin site).
3. That page immediately opens **`collectivelive://reset-password#...`** with tokens.
4. The app’s **`/(auth)/reset-password`** screen calls **`setSession`**, then **`/(auth)/change-password`** so they type the new password **inside the app**.

### Repo pieces

| Piece | Purpose |
|--------|--------|
| `admin-setup/public/auth-recovery.html` | HTTPS bridge: forwards hash/query → app scheme |
| `EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` | Full URL to that file, e.g. `https://YOUR_VERCEL.app/auth-recovery.html` |
| `lib/passwordResetRedirect.ts` | Uses the HTTPS URL when set; otherwise Expo `Linking.createURL('reset-password')` |

**EAS builds** already set `EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` to  
`https://cadmin.kbmcollective.org/auth-recovery.html` in `eas.json` — change it if your admin domain is different.

**Local `.env`**: add the same variable and run `npx expo start --clear`.

---

## Supabase Dashboard (you must do this manually)

### 1. Redirect URLs

**Authentication → URL Configuration → Redirect URLs**

Add **exactly** (no typos, include `https`):

- `https://cadmin.kbmcollective.org/auth-recovery.html`  
  (or whatever matches `EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` after you deploy)

Also add (for dev / direct scheme):

- `collectivelive://reset-password`
- Any Expo Go URL you see when testing, e.g. `exp://192.168.x.x:8081/--/reset-password`

### 2. Site URL

**Authentication → URL Configuration → Site URL**

- Set to the **same HTTPS** recovery URL **or** your main public `https://` site.  
- **Do not** leave **`http://localhost:...`** for production users — that’s what causes the phone browser to show **localhost / null** errors.

### 3. Custom SMTP + sender name

With **Custom SMTP** enabled, set **sender display name** and **from address** in the same Auth / SMTP settings (wording varies by dashboard version).  
If mail still says only “Supabase”, check the provider’s **From** header and any Supabase **template** overrides.

---

## Deploy the bridge page

From `admin-setup`:

```bash
npm run build
npx vercel --prod
```

Confirm in a browser:

`https://<your-vercel-domain>/auth-recovery.html` loads (even without hash).

---

## Quick verification

1. Dashboard: Redirect URLs + Site URL updated as above.  
2. Vercel: `auth-recovery.html` deployed.  
3. App: `.env` or EAS has `EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` matching that file.  
4. Send a **new** reset email and open the link on a phone with KBM Connect installed → app should open → **Change password** screen.

---

## Troubleshooting: “missing login data” or “Reset link not found in app”

- **“Missing login data” in the browser** means `auth-recovery.html` loaded **without** Supabase tokens in the URL (no `#access_token=…`, `type=recovery`, or `code=`). Common causes:  
  - **Corporate / Outlook “Safe Links”** or other scanners **open the link once** and burn the one-time token before you tap it. Try forwarding the email to Gmail/Apple Mail, or use “original URL” / disable link wrapping for that message.  
  - **Opening the link twice** — recovery links are often single-use; request a **new** reset and open it **once**.  
  - **Hosting** must serve the real **`/auth-recovery.html`** file from `admin-setup/public/` (Vite copies it to `dist/`). If the host uses a catch-all SPA rule that returns `index.html` for every path, fix routing so **`auth-recovery.html` is excluded** (see `admin-setup/vercel.json`: explicit rule before the SPA fallback).  
- **“Reset link not found in app”** means the app opened the reset screen **without** a `collectivelive://reset-password?…` handoff. After a failed browser step, go back to email and tap the **newest** link once; do not open the app first and expect the session to appear.

---

## Security advisors (MCP snapshot)

Unrelated to password reset but flagged on the project: some **RLS** / **function search_path** advisories. See Dashboard **Advisors** for details and fixes.
