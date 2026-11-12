# KBM Connect — Security Audit Report (OWASP ASVS V2 Authentication only)

**Date:** 2026-08-01  
**Scope:** Authentication (OWASP ASVS 5.0 Category V2) only — password policy, hashing, MFA, session management, account lockout / rate limiting.  
**Surfaces reviewed:** Expo mobile, admin-setup (cadmin), Edge Functions, related SQL migrations.

---

### Summary
- Total Issues: 8
- Critical: 0
- High: 3
- Medium: 4
- Low: 1

**Authentication scorecard:** **2 / 5** — Partial (⚠️)

| Control | Status | Notes |
|---------|--------|-------|
| Password policy (min 12 + complexity) | ❌ Fail | Uniform min 8; no complexity anywhere in app or Edge Functions |
| Password hashing | ✅ Pass | Supabase Auth only (hosted bcrypt); no custom password stores |
| MFA | ⚠️ Partial | Platform admins: email OTP step-up (server-enforced). Event admins: none. TOTP UI present but unwired. Mobile: no MFA enrollment |
| Session management | ⚠️ Partial | Auto-refresh + persist OK; tokens in AsyncStorage / localStorage; no idle timeout in repo |
| Account lockout (≤5 failures) | ⚠️ Partial | IP fail throttle (20/hr) + alerts at 5; no per-account lockout; clients fail-open |

---

### Critical Findings (Must Fix Before Launch)

_None identified in this V2-only pass._

---

### High Findings (Should Fix Before Launch)

#### H1 — Password minimum length 8 (ASVS expects ≥12); no complexity

1. **SEVERITY:** High  
2. **LOCATION:**  
   - `app/(auth)/register.tsx:46-48`  
   - `supabase/functions/admin-reset-user-password/index.ts:70-72`  
   - `supabase/functions/bulk-create-users/index.ts:160-161`  
   - `admin-setup/src/lib/adminResetUserPassword.ts:29-30`  
   - `admin-setup/src/pages/delegate-portal/DelegateSetPassword.tsx:49-50`  
   - `admin-setup/src/pages/vendor-portal/VendorSetPassword.tsx:49-50`  
   - `admin-setup/src/pages/RegistrationPortal.tsx:358`  
   - `app/(auth)/change-password.tsx:51-52` / `app/(tabs)/profile/change-password.tsx:58`  
3. **ISSUE:** All password create/reset paths enforce only `length >= 8`. There is no complexity rule (upper/lower/digit/symbol or denylist). `send-app-password-reset` does not set passwords (email link only) — final password still goes through client + GoTrue with the same weak policy. No `minimum_password_length` / policy config in-repo (`supabase/config.toml` has no Auth password policy).  
4. **IMPACT:** Short / guessable passwords increase credential-stuffing and brute-force success, especially for event admins who lack a second factor.  
5. **FIX:** Raise to ≥12 everywhere (client + Edge + ideally Supabase Auth dashboard “Minimum password length”). Add shared validator, e.g.:

```ts
export function assertPasswordPolicy(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use upper, lower, and a number.';
  }
  return null;
}
```

Mirror the same checks in `admin-reset-user-password` and `bulk-create-users` before `auth.admin.updateUserById` / createUser.

---

#### H2 — Event admins: no MFA; TOTP (`LoginMfa` / `cadminMfa`) is dead code

1. **SEVERITY:** High  
2. **LOCATION:**  
   - `admin-setup/src/pages/Login.tsx:126-128` (event admin → `/` after password only)  
   - `admin-setup/src/App.tsx:215-217` (non–platform-admin gate skipped)  
   - `admin-setup/src/pages/LoginMfa.tsx` + `admin-setup/src/lib/cadminMfa.ts` (TOTP helpers exist)  
   - Grep: `LoginMfa` is **never imported** into routes/`App.tsx`  
3. **ISSUE:** Platform admins get email OTP step-up. Event admins with full event admin UI authenticate with password only. Existing Supabase TOTP MFA UI is orphaned and not part of the login gate.  
4. **IMPACT:** Compromised event-admin password yields full event administration (members, password resets for attendees, badges, etc.) with no second factor.  
5. **FIX:** Wire MFA into the post-password gate for **all** cadmin roles (enroll + AAL2), or require email OTP for event admins too. Prefer authenticator TOTP (phishing-resistant vs email) and enforce AAL2 server-side for admin RPCs where possible.

---

#### H3 — No per-account lockout after 5 failures (ASVS V2.2.1-style)

1. **SEVERITY:** High  
2. **LOCATION:**  
   - `supabase/functions/login-rate-limit/index.ts:19-49` (`MAX_FAIL_IP_HOUR = 20`, IP-only)  
   - Comments at `login-rate-limit/index.ts:6-8` (email lockout intentionally omitted)  
   - `supabase/migrations/20260528150000_platform_security_enhancements.sql:100-118` (`process_brute_force_anomaly_alerts` alerts at ≥5 failures / 15m — **does not lock**)  
   - `supabase/functions/process-security-anomalies/index.ts:38-39` (cron → alert email only)  
3. **ISSUE:** Rate limit is **20 failed attempts per gateway IP per hour**. There is no account-level lock after 5 failures. Anomaly processing notifies admins but continues to allow Auth attempts. Distributed attackers (many IPs) can still target one email.  
4. **IMPACT:** Targeted password guessing against a known admin/attendee email is not stopped at the ASVS “5 failures” threshold.  
5. **FIX:** After N failures for an identity, require a cooldown or CAPTCHA / email challenge before further `signInWithPassword`, implemented **server-side** (Auth Hook or Edge + Auth rate policies) without enabling cross-user lockout abuse. Combine with stricter IP limits for admin surfaces.

---

### Medium Findings (Fix within 30 days)

#### M1 — Login rate-limit clients fail open

1. **SEVERITY:** Medium  
2. **LOCATION:**  
   - `lib/loginRateLimit.ts:28-34` (`if (!res.ok) return { allowed: true }`; catch → allow)  
   - `admin-setup/src/lib/loginRateLimit.ts:28-34` (same)  
3. **ISSUE:** If `login-rate-limit` is down, times out, or returns non-OK, login proceeds.  
4. **IMPACT:** During Edge outages, brute-force protection disappears while Auth remains available.  
5. **FIX:** Fail closed for admin/cadmin (deny with “try again later”), or fail closed after repeated Edge failures. Keep fail-open only for low-risk public signup if product requires availability.

---

#### M2 — Mobile session tokens stored in AsyncStorage (not hardware-backed SecureStore)

1. **SEVERITY:** Medium  
2. **LOCATION:** `lib/supabase.ts:100-105` (`storage: AsyncStorage`, `persistSession: true`, `autoRefreshToken: true`)  
3. **ISSUE:** Refresh/access tokens persist in AsyncStorage (unencrypted app sandbox). Admin web uses default browser storage (`admin-setup/src/lib/supabase.ts:19-21`).  
4. **IMPACT:** On rooted/jailbroken devices or backup extraction, long-lived refresh tokens can be stolen.  
5. **FIX:** Use `expo-secure-store` (or Supabase recommended secure storage adapter) for auth storage on native; consider shorter JWT / refresh lifetimes in Supabase Auth settings; add idle re-auth for admin.

---

#### M3 — Platform-admin MFA is email OTP (not TOTP); 6-hour step-up window

1. **SEVERITY:** Medium  
2. **LOCATION:**  
   - `supabase/functions/platform-admin-email-otp/index.ts:16-17` (`OTP_TTL_MS` 10m, `STEP_UP_TTL_MS` 6h)  
   - `supabase/migrations/20260717220000_security_authorization_hardening.sql:70-93` (`is_platform_admin` requires `has_platform_admin_step_up`)  
3. **ISSUE:** Second factor is email OTP (same channel as password reset / account recovery). Step-up remains valid for 6 hours per Auth `session_id`. TOTP code exists but is unused.  
4. **IMPACT:** Email compromise (or mailbox takeover) bypasses both password reset and step-up. Long step-up window extends exposure on stolen laptop sessions.  
5. **FIX:** Prefer TOTP/WebAuthn for platform admins; shorten `STEP_UP_TTL_MS` (e.g. 30–60 minutes) for high-privilege actions; keep email OTP as backup only.

---

#### M4 — Rate limit skipped when client IP cannot be determined

1. **SEVERITY:** Medium  
2. **LOCATION:** `supabase/functions/login-rate-limit/index.ts:41-41` (`if (!ip) return false`)  
3. **ISSUE:** If `x-forwarded-for` / `x-real-ip` are missing, `isBlocked` never blocks.  
4. **IMPACT:** Misconfigured proxies or direct invokes can bypass the IP throttle.  
5. **FIX:** When IP is null, apply a conservative default (e.g. treat as blocked for `record` floods, or rate-limit by hashed email with challenge — carefully to avoid lockout DoS).

---

### Low Findings

#### L1 — Password trimming before admin set

1. **SEVERITY:** Low  
2. **LOCATION:** `supabase/functions/admin-reset-user-password/index.ts:52-53` (`newPasswordRaw.trim()`)  
3. **ISSUE:** Leading/trailing spaces stripped before storing.  
4. **IMPACT:** Minor policy inconsistency if users intentionally use spaces; generally low risk.  
5. **FIX:** Do not trim passwords (trim email only); validate length on raw string.

---

### What PASSES (Authentication)

| Area | Evidence |
|------|----------|
| **Hashing via Supabase Auth only** | No custom bcrypt/argon2/password columns; creates/resets use `supabase.auth.signUp` / `signInWithPassword` / `auth.admin.updateUserById`. GoTrue stores hashes server-side. |
| **Admin password reset authorization** | `admin-reset-user-password`: Bearer required; platform vs event admin checks; cannot reset platform admin unless caller is platform admin (`index.ts:88-127`). |
| **Password-reset anti-enumeration + rate limits** | `send-app-password-reset`: always 200; 1/email/15m, 3/email/hour, 10/IP/hour; respects `password_reset_blocked` (`index.ts:128-148`). |
| **Platform admin step-up server enforcement** | `is_platform_admin()` ANDs `has_platform_admin_step_up` (`20260717220000_security_authorization_hardening.sql:72-93`). UI gate in `App.tsx` + `platform-admin-email-otp` (HMAC-hashed codes, attempt limits, session binding). |
| **OTP hygiene** | Codes hashed with HMAC; max 5 verify attempts; resend cooldown; send window cap (`platform-admin-email-otp/index.ts:16-21`, `268-290`). |
| **Login attempt logging** | Mobile/cadmin/portals call `log-auth-attempt`; throttle 30 writes/email/hour (`log-auth-attempt/index.ts:58-67`). |
| **Brute-force detection / alerting** | `process-security-anomalies` + `process_brute_force_anomaly_alerts` (5 fails / email or IP in 15m; credential scan ≥3 emails) — **alerts**, not lockout. |
| **Auth login attempts table locked down** | RLS + revoke from anon/authenticated (`20260717150000_auth_login_attempts.sql`). |
| **Deactivated accounts** | Login paths check `is_active` and sign out (mobile `authStore`, cadmin `Login.tsx`). |
| **Session refresh** | `autoRefreshToken: true`, foreground refresh helpers (`lib/supabase.ts`). |
| **Mobile MFA for password change (if factor exists)** | `lib/mfaSession.ts` + change-password screens elevate to AAL2 before password update — but **enrollment UX for mobile is absent**, so this only helps if MFA was enrolled elsewhere. |
| **Intentional avoidance of email lockout DoS** | Documented in `login-rate-limit` header comments — good threat-model note; still leaves ASVS gap (H3). |

---

### Priority Remediation Plan (V2)

1. **Raise password policy to ≥12 + complexity** on all create/reset paths and Supabase Auth project settings (H1).  
2. **Require MFA for all cadmin roles** — wire TOTP (`LoginMfa`) or extend email OTP to event admins; remove dead-code risk of assuming MFA is on (H2).  
3. **Add real lockout / progressive delay** after repeated failures for an identity, plus keep IP limits; do not rely on alerts alone (H3).  
4. **Fail closed** for cadmin when rate-limit Edge is unreachable (M1); store mobile tokens in SecureStore (M2); prefer TOTP and shorten step-up TTL (M3).

---

### Out of scope this pass

Authorization (V4), input validation, encryption headers, dependencies (`npm run audit:security`), AISVS — not assessed in this report. Re-run `/kbm-security-audit` for full ASVS.
