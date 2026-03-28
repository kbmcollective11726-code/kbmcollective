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
`https://admin-setup-omega.vercel.app/auth-recovery.html` in `eas.json` — change it if your Vercel domain is different.

**Local `.env`**: add the same variable and run `npx expo start --clear`.

---

## Supabase Dashboard (you must do this manually)

### 1. Redirect URLs

**Authentication → URL Configuration → Redirect URLs**

Add **exactly** (no typos, include `https`):

- `https://admin-setup-omega.vercel.app/auth-recovery.html`  
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

## Security advisors (MCP snapshot)

Unrelated to password reset but flagged on the project: some **RLS** / **function search_path** advisories. See Dashboard **Advisors** for details and fixes.
