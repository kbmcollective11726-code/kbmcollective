# KBM Connect — AUTH + AUTHORIZATION Checklist Audit

**Date:** 2026-08-01  
**Scope:** Targeted checks (password policy, MFA wiring, login-rate-limit, deactivate scope, bulk-create roles, SECURITY DEFINER grants, cron fail-closed, session storage)  
**Evidence:** Source + live Postgres via Supabase MCP (`is_event_admin`, `is_event_member`, `users_update_perm`, EXECUTE grants)

### Summary
- Total Issues: 7
- Critical: 0
- High: 3
- Medium: 3
- Low: 1

---

## Checklist results

| # | Check | Result |
|---|--------|--------|
| 1 | Password min length | **Fail** — min 8 everywhere (ASVS ≥12) |
| 2 | MFA platform vs event admins | **Fail** — platform email OTP only; TOTP unwired; event admins password-only |
| 3 | login-rate-limit per-email + shared secret | **Partial Pass** — Edge enforces both; secret shipped in clients; clients fail-open |
| 4 | Event-scoped vs global deactivate | **Partial** — Edge Function fixed; DB trigger/RLS still allow event-admin global `users.is_active`; `is_event_admin` ignores membership `is_active` |
| 5 | bulk-create admin role restriction | **Pass** — event admins cannot mint `admin` |
| 6 | SECURITY DEFINER grants / admin RPC authz | **Pass** (sampled) — grants tightened; bodies check roles |
| 7 | Cron fail-closed | **Pass** — all checked cron edges require `CRON_SECRET` |
| 8 | Session storage AsyncStorage vs SecureStore | **Fail** — AsyncStorage (mobile); localStorage default (cadmin) |

---

### High Findings (Should Fix Before Launch)

#### H1 — Password minimum length 8 (ASVS expects ≥12); no complexity

1. **SEVERITY:** High  
2. **LOCATION:**  
   - `app/(auth)/register.tsx:46-47`  
   - `app/(auth)/change-password.tsx:51-52`  
   - `app/(tabs)/profile/change-password.tsx:57-58`  
   - `admin-setup/src/pages/RegistrationPortal.tsx:358-359`  
   - `admin-setup/src/pages/delegate-portal/DelegateSetPassword.tsx:49-50`  
   - `admin-setup/src/pages/vendor-portal/VendorSetPassword.tsx:49-50`  
   - `admin-setup/src/lib/adminResetUserPassword.ts:29-30`  
   - `supabase/functions/admin-reset-user-password/index.ts:70-71`  
   - `supabase/functions/bulk-create-users/index.ts:160-161`  
3. **ISSUE:** All create/reset paths enforce only `length >= 8`. No complexity / denylist. No Auth password policy in `supabase/config.toml`.  
4. **IMPACT:** Guessable passwords increase credential-stuffing success, especially for event admins with no MFA.  
5. **FIX:** Raise to ≥12 on every client + Edge path; set Supabase Auth minimum password length in dashboard; share one `assertPasswordPolicy()` helper.

```ts
export function assertPasswordPolicy(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use upper, lower, and a number.';
  }
  return null;
}
```

---

#### H2 — Event admins: no MFA; `LoginMfa` / `cadminMfa` orphaned

1. **SEVERITY:** High  
2. **LOCATION:**  
   - `admin-setup/src/pages/Login.tsx:127-129` (event admin → `/` after password)  
   - `admin-setup/src/App.tsx:215-217` (non–platform-admin skips OTP gate)  
   - `admin-setup/src/pages/LoginMfa.tsx` + `admin-setup/src/lib/cadminMfa.ts` (never routed)  
   - Mobile: no MFA enroll/gate in `app/_layout.tsx` / `stores/authStore.ts`  
3. **ISSUE:** Platform admins get email OTP step-up (server-enforced via `is_platform_admin` → `has_platform_admin_step_up`). Event admins authenticate with password only. TOTP UI exists but is not imported into `App.tsx` routes.  
4. **IMPACT:** Stolen event-admin password yields full event admin (members, password resets, badges) with no second factor.  
5. **FIX:** Route `/login/mfa` after password for all cadmin roles; require AAL2 (or email OTP) before admin UI; enforce AAL2/step-up on sensitive Edge/RPC where possible.

---

#### H3 — Event-admin global deactivate still possible via PostgREST (Edge path fixed)

1. **SEVERITY:** High  
2. **LOCATION:**  
   - **Pass (Edge):** `supabase/functions/set-account-active/index.ts:63-131` (event_id → `event_members.is_active` only); `:134-139` (global requires platform admin)  
   - **Pass (UI):** `admin-setup/src/pages/Members.tsx:782-786` passes `eventId`  
   - **Fail (DB):** live `users_update_perm` + `enforce_is_active_admin_only()` still allow any event admin of a shared event to UPDATE `users.is_active`  
   - **Gap:** live `is_event_admin()` does **not** check `event_members.is_active` (only `is_event_member` does)  
3. **ISSUE:** UI/Edge correctly scope event suspend, but a client can still `UPDATE public.users SET is_active=false` for co-members. Suspended event admins retain `is_event_admin()` privileges.  
4. **IMPACT:** Cross-event / global lockout DoS; event-scoped suspend incomplete for admin roles.  
5. **FIX:**

```sql
-- Trigger: platform admin only for users.is_active
IF NOT public.is_platform_admin(v_uid) THEN
  RAISE EXCEPTION 'Only platform admins can change global account status';
END IF;

-- Helper: honor membership suspend
AND COALESCE(em.is_active, true) = true  -- add inside is_event_admin EXISTS
```

Optionally column-restrict profile updates so event admins cannot touch `is_active`.

---

### Medium Findings (Fix within 30 days)

#### M1 — `LOG_AUTH_ATTEMPT_SECRET` embedded in public client builds

1. **SEVERITY:** Medium  
2. **LOCATION:**  
   - `eas.json` preview/production `EXPO_PUBLIC_LOG_AUTH_ATTEMPT_SECRET`  
   - `lib/loginRateLimit.ts:5-6` / `admin-setup/src/lib/loginRateLimit.ts:5-6`  
   - Edge correctly requires secret: `supabase/functions/login-rate-limit/index.ts:86-94`  
3. **ISSUE:** Shared secret is shipped via `EXPO_PUBLIC_*` / `VITE_*`, so extractable from app/JS bundles. Anyone with the secret can `record` forged failures and lock emails (5 / 15m).  
4. **IMPACT:** Targeted account lockout DoS; secret does not provide real server-only trust.  
5. **FIX:** Prefer Supabase Auth Hooks / server-side login rate limiting that does not need a client-held secret; or short-lived HMAC tokens from a backend. Rotate secret out of `eas.json` / git history.

---

#### M2 — Login rate-limit clients fail open

1. **SEVERITY:** Medium  
2. **LOCATION:** `lib/loginRateLimit.ts:34-40`; `admin-setup/src/lib/loginRateLimit.ts:34-40`  
3. **ISSUE:** Non-OK responses, missing secret, and network errors return `{ allowed: true }`.  
4. **IMPACT:** During Edge outages, brute-force protection disappears while Auth remains available.  
5. **FIX:** Fail closed for cadmin/platform admin login; optional fail-open only for low-risk attendee login.

---

#### M3 — Mobile session tokens in AsyncStorage (not SecureStore)

1. **SEVERITY:** Medium  
2. **LOCATION:** `lib/supabase.ts:100-105` (`storage: AsyncStorage`); no `expo-secure-store` usage in `app/`; cadmin `admin-setup/src/lib/supabase.ts:19-21` uses default browser storage  
3. **ISSUE:** Refresh/access tokens persist in unencrypted AsyncStorage / localStorage.  
4. **IMPACT:** On rooted/jailbroken devices or backup extraction, long-lived refresh tokens can be stolen.  
5. **FIX:** Use Expo SecureStore (or Supabase-recommended secure adapter) for native auth storage; shorten refresh lifetime; idle re-auth for admin.

---

### Low Findings

#### L1 — Admin reset trims password before length check / store

1. **SEVERITY:** Low  
2. **LOCATION:** `supabase/functions/admin-reset-user-password/index.ts:52-53`  
3. **ISSUE:** `newPasswordRaw.trim()` before validation/storage.  
4. **IMPACT:** Minor policy inconsistency.  
5. **FIX:** Do not trim passwords; validate length on the raw string.

---

## Passes (evidence)

### Pass — login-rate-limit per-email + shared secret (server)

- `supabase/functions/login-rate-limit/index.ts:20-25` — IP 20/hr + email 5 fails / 15m  
- `index.ts:86-94` — fail-closed if `LOG_AUTH_ATTEMPT_SECRET` missing/mismatched (timing-safe compare)  
- Clients invoke with `x-log-auth-secret` from mobile + cadmin + portals  

*(Residual: M1 client-shipped secret, M2 fail-open — see Medium.)*

### Pass — bulk-create admin role restriction

- `supabase/functions/bulk-create-users/index.ts:174-193` — event admins filtered: `rolesList.filter((r) => r !== "admin")`; platform admins unrestricted  
- Applied on link-only and create paths (`:254`, `:275`)

### Pass — SECURITY DEFINER grants / admin RPC internal authz (samples)

- Migration `20260717241000_restrict_security_definer_rpc_grants.sql` revokes PUBLIC/anon on privileged defs; service-only for orphan/anomaly processors  
- Live: `admin_clear_user_report` anon_exec=false, auth_exec=true; `process_orphan_account_auto_deactivations` neither anon nor authenticated  
- Body authz samples: `admin_clear_user_report` requires platform/event admin (`20260717150000_admin_clear_reports_unblock.sql:30-47`); `list_vendor_attendee_badge_tokens` vendor/rep gate (`20260717245000_security_definer_body_hardening.sql:50-61`); `is_platform_admin` requires step-up (`20260717220000_security_authorization_hardening.sql:72-92`)  
- `20260801160000_event_membership_active_definer_grants.sql` revokes trigger-only defs from anon/authenticated  

### Pass — Cron fail-closed

All checked cron edges use `if (!cronSecret || header !== cronSecret) return 401`:

- `auto-deactivate-events`, `notify-event-starting-soon`, `notify-b2b-meeting-soon`, `nudge-b2b-meeting-feedback`, `process-scheduled-announcements`, `process-security-anomalies`, `process-orphan-signup-alerts`, `process-orphan-auto-deactivate`, `send-registration-submitted-email`, `send-security-alert-email`

### Pass — Password hashing

Supabase Auth only (hosted bcrypt); no custom password stores in-app.

### Pass (partial UX) — Event-scoped deactivate via intended UI/Edge path

Members UI + `set-account-active` with `event_id` updates `event_members.is_active` only; Platform Users omits `event_id` for global path. *(See H3 for remaining DB bypass.)*

---

### Priority Remediation Plan

1. **H3** — Restrict `users.is_active` to platform admins in trigger; add `em.is_active` to `is_event_admin`  
2. **H2** — Wire MFA for all cadmin roles (TOTP preferred)  
3. **H1** — Password min 12 + Edge/dashboard enforcement  
4. **M1/M2** — Stop shipping rate-limit secret; fail closed on cadmin  
5. **M3** — SecureStore for mobile sessions  
