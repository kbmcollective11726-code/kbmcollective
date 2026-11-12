# KBM Connect — Security Audit Report

**Focus:** OWASP ASVS V4 (Authorization) + V13 (API Security)  
**Date:** 2026-08-01  
**Evidence:** Live Postgres RLS via Supabase MCP (`pg_policies`), Edge Function source, migrations  
**Surfaces:** Expo app, admin-setup, live-wall, Supabase RLS, Edge Functions

### Summary
- Total Issues: 18
- Critical: 3
- High: 8
- Medium: 6
- Low: 1

---

## RBAC model (how it works)

| Role | Enforcement |
|------|-------------|
| **Platform admin** | `users.is_platform_admin` + **email OTP step-up** via `has_platform_admin_step_up` → `is_platform_admin()` RPC (`20260717220000_security_authorization_hardening.sql`) |
| **Event admin** | `event_members.role IN ('admin','super_admin')` via `is_event_admin(event_id)` (primary `role` column only; `roles[]` not checked in helper) |
| **Event creator** | Creates event only as platform admin (RLS); then `set-event-creator-admin` upserts self as event admin if `events.created_by = caller` |
| **Member / vendor / speaker** | `event_members`; self-join/update limited to non-admin roles (`20260712120000_event_members_block_self_admin.sql`) |
| **Deactivated** | Restrictive `active_accounts_only` on nearly all public tables for `authenticated` |

Client UI role checks are **not** authoritative; server RLS / Edge Function RPC checks are.

---

### Critical Findings (Must Fix Before Launch)

#### C1. Anon can read all user PII (email, phone, push_token, admin flag)
- **SEVERITY:** Critical  
- **LOCATION:** Live policy `Users are viewable by everyone` on `public.users` (`USING (true)`); source `supabase-schema.sql:462`; confirmed live 2026-08-01  
- **ISSUE:** SELECT policy is unconditionally true for role `public` (includes `anon`). Columns include `email`, `phone`, `push_token`, `is_platform_admin`, `linkedin_url`, etc.  
- **IMPACT:** Anyone with the published anon key (mobile, live-wall, admin) can dump the entire user directory and PII; enables spam, phishing, push hijack targeting, and privilege reconnaissance.  
- **FIX:**
```sql
DROP POLICY "Users are viewable by everyone" ON public.users;
CREATE POLICY users_select_scoped ON public.users FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_platform_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.event_members me
    JOIN public.event_members them ON them.event_id = me.event_id
    WHERE me.user_id = auth.uid() AND them.user_id = users.id
  )
);
-- Expose only safe columns to anon via a view or SECURITY DEFINER RPC for live-wall leaderboard names/avatars.
REVOKE SELECT ON public.users FROM anon;
```

#### C2. `send-announcement-push` — authenticated caller can push to arbitrary users
- **SEVERITY:** Critical  
- **LOCATION:** `supabase/functions/send-announcement-push/index.ts:50-99` (JWT checked; **no** role / relationship / recipient authorization)  
- **ISSUE:** Any valid user JWT can supply arbitrary `title`, `body`, and `recipient_user_ids`. Function uses service role to load push tokens and sends via Expo.  
- **IMPACT:** Cross-user notification spam / phishing / social engineering to the entire user base.  
- **FIX:** Authorize by action type: announcement → `is_event_admin`/`is_platform_admin`; like/comment → verify caller caused the engagement and recipients are limited to post author; chat → verify conversation membership. Cap recipients; rate-limit.

#### C3. Cross-event / global public read of posts, comments, memberships
- **SEVERITY:** Critical (combined data-exfil surface with C1)  
- **LOCATION (live):**
  - `posts_select_perm`: `(…admin…) OR (is_deleted = false)` — `20260703260000_perf_multiple_permissive_merge.sql:387-390`
  - `Comments are viewable`: `USING (true)`
  - `event_members_select_perm`: `… OR true` — same file `:118-119`
- **ISSUE:** Anon (and any client) can read **all** non-deleted posts, all comments, and all event memberships (user_id, role, points) across **every** event without membership. Live-wall filters by `event_id` in the app only.  
- **IMPACT:** Cross-event content and attendee graph enumeration; defeats event isolation; amplifies live-wall anon-key exposure.  
- **FIX:** Scope SELECT to: event member **or** (for live-wall) `events.live_wall_public = true` / dedicated wall RPC returning only approved fields for one event. Remove `OR true` / bare `is_deleted = false` for anon.

---

### High Findings (Should Fix Before Launch)

#### H1. Event admin can globally deactivate / Auth-ban any co-member
- **SEVERITY:** High  
- **LOCATION:** `supabase/functions/set-account-active/index.ts:61-131`; DB trigger `enforce_is_active_admin_only` also allows any event admin of a shared event (`20260717230000_security_followup_hardening.sql:69-76`)  
- **ISSUE:** `users.is_active` and Auth `ban_duration` are **global**. Event admin of Event A can lock a user out of all events/portals/app.  
- **IMPACT:** Cross-tenant denial of service / abuse between events.  
- **FIX:** Prefer event-scoped suspension (`event_members.is_suspended`) for event admins; reserve global ban for verified platform admins only.

#### H2. Event admin can mint Auth users + assign `admin` via bulk-create (service role)
- **SEVERITY:** High  
- **LOCATION:** `supabase/functions/bulk-create-users/index.ts:174-186`, `:221-229`, `:303-311`; `VALID_ROLES` includes `admin` (`:21`)  
- **ISSUE:** After JWT + `is_event_admin`, service role creates users and upserts `role: 'admin'`. No restriction preventing event admins from proliferating admins or creating accounts with a shared `default_password` (min 8).  
- **IMPACT:** Privilege proliferation; weak shared passwords; account takeover of newly created users.  
- **FIX:** Event admins: allow only `attendee|speaker|vendor`; require platform admin for `admin` role and for create-with-password; force unique temp passwords / invite-only.

#### H3. Unauthenticated registration email / invite endpoint (service role)
- **SEVERITY:** High  
- **LOCATION:** `supabase/functions/send-registration-setup-email/index.ts:146-205` (no caller JWT; service role; gated only by `registration_open`)  
- **ISSUE:** Anyone can POST `event_id` + `email` when registration is open; triggers Auth invite/magic-link flows and may update `user_metadata`.  
- **IMPACT:** Email bombing; invite spam; metadata overwrite for existing accounts.  
- **FIX:** Require proof of a just-created submission (signed token / submission id + secret), plus strict rate limits per IP/email/event.

#### H4. Cron Edge Functions open if `CRON_SECRET` unset
- **SEVERITY:** High (config-dependent)  
- **LOCATION:** e.g. `supabase/functions/auto-deactivate-events/index.ts:30-37` — `if (cronSecret && header !== cronSecret)`; same pattern on `notify-event-starting-soon`, `process-scheduled-announcements`, `nudge-b2b-meeting-feedback`, etc.  
- **ISSUE:** When env var missing, auth check is skipped; function still uses service role.  
- **IMPACT:** Public caller can deactivate events / trigger mass notifications / process jobs.  
- **FIX:** Fail closed: `if (!cronSecret || header !== cronSecret) return 401`.

#### H5. Public SELECT on schedules, booths, meeting slots, comment likes (`OR true` / `USING true`)
- **SEVERITY:** High  
- **LOCATION (live):** `schedule_sessions_select_perm` (`… OR true`); `vendor_booths_select_perm`; `vendor_booth_reps_select_perm`; `meeting_slots_select_perm`; `comment_likes` SELECT `true` (`20260709200000_comment_likes.sql:99-100`)  
- **ISSUE:** Full cross-event schedule and booth inventory readable by anon.  
- **IMPACT:** Competitive intel / privacy leak of unpublished event structure; supports scraping.  
- **FIX:** Member-scoped SELECT; optional public flag per event for live-wall.

#### H6. Any authenticated user can INSERT posts into any event
- **SEVERITY:** High  
- **LOCATION:** Live `posts_insert_perm` WITH CHECK: admin OR `auth.uid() = user_id` — **no** `event_members` membership requirement (`20260703260000_perf_multiple_permissive_merge.sql:391-394`)  
- **ISSUE:** Authenticated users can create posts (and thus feed content) for events they do not belong to.  
- **IMPACT:** Spam / content injection into foreign events.  
- **FIX:**
```sql
WITH CHECK (
  auth.uid() = user_id
  AND (
    public.is_event_admin(event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = posts.event_id AND em.user_id = auth.uid()
    )
  )
);
```

#### H7. `log-auth-attempt` unauthenticated + service role writes audit log
- **SEVERITY:** High  
- **LOCATION:** `supabase/functions/log-auth-attempt/index.ts:18-99`  
- **ISSUE:** No JWT; accepts email/success/source; resolves user id by email; writes `platform_audit_log` (throttled 30/hour/email).  
- **IMPACT:** Audit-log pollution; partial email→user existence oracle.  
- **FIX:** Prefer Auth hooks / server-only logging; or HMAC shared secret + stricter rate limits; never resolve user ids for anonymous callers.

#### H8. Broad table GRANTs to `anon` (including DELETE/TRUNCATE)
- **SEVERITY:** High (defense-in-depth; PostgREST does not expose TRUNCATE, but DELETE/UPDATE grants + weak policies are dangerous)  
- **LOCATION:** Live `information_schema.role_table_grants` — `anon` has SELECT/INSERT/UPDATE/DELETE/TRUNCATE on `users` and many other tables; enabled by patterns like `20260527100000_explicit_public_table_grants.sql`  
- **ISSUE:** Over-privileged database role; TRUNCATE bypasses RLS if ever reachable via SQL.  
- **IMPACT:** Larger blast radius on misconfiguration or alternate DB clients.  
- **FIX:** `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` then grant only required SELECT on specific views/tables.

---

### Medium Findings (Fix within 30 days)

#### M1. CORS `Access-Control-Allow-Origin: *` on all Edge Functions
- **SEVERITY:** Medium  
- **LOCATION:** Every function under `supabase/functions/*/index.ts` (e.g. `delete-user/index.ts:7-10`, `bulk-create-users/index.ts:8-11`)  
- **ISSUE:** Any browser origin can invoke functions with a stolen Bearer token (no cookie CSRF, but widens XSS/token-theft impact).  
- **IMPACT:** Stolen JWTs usable from attacker-controlled pages more easily.  
- **FIX:** Allowlist `connect.kbmcollective.org`, admin host, and known app origins; omit `*` for credentialed admin APIs.

#### M2. Gateway `verify_jwt = false` on sensitive functions
- **SEVERITY:** Medium  
- **LOCATION:** `supabase/config.toml:3-72` (`delete-user`, `bulk-create-users`, `admin-*`, R2 upload, etc.)  
- **ISSUE:** Relies entirely on in-function checks; mis-edit that drops `getUser` becomes a service-role backdoor.  
- **IMPACT:** Single-point failure for authz.  
- **FIX:** Keep in-function auth; add shared middleware helper + regression tests; prefer `verify_jwt = true` where clients allow.

#### M3. Self-join any event as attendee/speaker/vendor
- **SEVERITY:** Medium  
- **LOCATION:** `event_members_insert_perm` — self-insert non-admin roles (`20260712120000_event_members_block_self_admin.sql:6-18`)  
- **ISSUE:** No invite/approval gate.  
- **IMPACT:** Unauthorized attendance / access to member-only data once SELECT is tightened incorrectly.  
- **FIX:** Require invite code, admin add, or approved registration link.

#### M4. Platform-admin step-up bypassed by raw `users.is_platform_admin` in some RLS
- **SEVERITY:** Medium  
- **LOCATION:** `schedule_sessions_*` policies check `users.is_platform_admin = true` directly (`20260703260000_perf_multiple_permissive_merge.sql:413-421`) instead of `is_platform_admin()`  
- **ISSUE:** Platform admin without email OTP step-up can still mutate schedules.  
- **IMPACT:** Weakens MFA step-up for schedule admin APIs.  
- **FIX:** Replace with `public.is_platform_admin((SELECT auth.uid()))`.

#### M5. Rate limiting incomplete for privileged / abusive APIs
- **SEVERITY:** Medium  
- **LOCATION:** Coverage exists: `login-rate-limit` (IP, 20 fails/hour), `send-app-password-reset` rate limits, soft throttle in `log-auth-attempt`. **Missing:** bulk-create, set-account-active, admin-reset-password, R2 upload, send-announcement-push, send-registration-setup-email.  
- **ISSUE:** Authenticated or public endpoints can be abused at volume.  
- **IMPACT:** DoS, spam, password-spray amplification, storage cost.  
- **FIX:** Per-user/IP quotas on Edge Functions (Redis/DB counters).

#### M6. `upload-image-to-r2` `processOnly` skips path authorization
- **SEVERITY:** Medium  
- **LOCATION:** `supabase/functions/upload-image-to-r2/index.ts:148-156`  
- **ISSUE:** When `processOnly=true`, skips `authorizeR2Upload` (still requires JWT + active account; returns base64 only).  
- **IMPACT:** CPU/memory DoS via large base64 (partially mitigated by 6MB cap).  
- **FIX:** Always require authz context; rate-limit; keep size cap.

---

### Low Findings

#### L1. `is_event_admin` ignores `roles[]` array
- **SEVERITY:** Low  
- **LOCATION:** `20260717220000_security_authorization_hardening.sql:96-111` — checks `em.role IN ('admin','super_admin')` only  
- **ISSUE:** Admin present only in `roles[]` with primary `role='attendee'` would not get admin RPC rights (fail-closed).  
- **IMPACT:** Inconsistent UX if data drifts; not an escalation path.  
- **FIX:** Align helper with array OR document that `role` is always authoritative.

---

## Passes (V4 / V13)

| Area | Evidence |
|------|----------|
| Platform admin step-up | `is_platform_admin()` requires OTP session (`20260717220000…:70-93`) |
| Event create locked to platform admin | `events_insert_perm` (`20260717230000…:87-96`) |
| Self-escalation to event admin blocked | `event_members_*` role constraints (`20260712120000…`) |
| `is_platform_admin` / `is_active` field protection | Triggers `protect_user_security_fields`, `enforce_is_active_admin_only` |
| `delete-user` | JWT + self OR verified platform admin (`delete-user/index.ts:44-67`) |
| `set-event-creator-admin` | JWT + `created_by` match (`set-event-creator-admin/index.ts:42-75`) |
| `admin-reset-user-password` | JWT + platform/event admin + membership bind (`admin-reset-user-password/index.ts:88-126`) |
| `admin-download-post-photo` / `admin-zip-event-photos` | JWT + `canManageEventPosts` |
| `get-r2-upload-url` / path authz | JWT + `authorize-r2-upload.ts` membership/path/content-type |
| `upload-image-to-r2` (normal path) | Same authz pattern |
| `set-account-active` caller checks | JWT; blocks self; membership bind for event admins; blocks demoting platform admins without platform admin |
| `notify-portal-features-opened` | JWT + platform/event admin |
| Messages RLS | Sender/receiver only (live) |
| Point log client insert revoked | `20260717235000_points_notifications_rpc_hardening.sql` |
| Live-wall sponsors SELECT | Scoped to `show_on_live_wall` + active event (live `event_sponsors_select_perm`) |
| Login rate limit design | IP-only pre-auth; avoids email lockout DoS (`login-rate-limit/index.ts`) |

---

### Compliance Scorecard (this pass)

| Category | Score | Status |
|----------|-------|--------|
| Authorization (V4) | 2/5 | ❌ |
| API Security (V13) | 2/5 | ❌ |
| Authentication | — | See `2026-08-01-asvs-v2-authentication.md` |
| Input Validation | — | Not in scope this pass |
| Encryption | — | Not in scope |
| Logging | — | Partial note via H7 |
| Data Protection | — | Impacted by C1/C3 |
| Cloud Security | — | Not in scope |
| Dependencies | — | See `2026-08-01-deps-preflight.md` |

---

### Priority Remediation Plan
1. **C1 + C3** — Rewrite `users` / `posts` / `comments` / `event_members` SELECT policies; stop anon PII and cross-event dumps (blocks launch).  
2. **C2** — Add recipient/action authorization + rate limits to `send-announcement-push`.  
3. **H1 + H2** — Scope event-admin powers (no global ban; no admin-role minting).  
4. **H3 + H4 + H7** — Fail-closed cron auth; lock down unauthenticated Edge Functions.  
5. **H5 + H6 + H8** — Tighten remaining public SELECTs, post INSERT membership, revoke anon over-grants.  
6. **M1–M6** — CORS allowlists, verify_jwt strategy, rate limits, step-up consistency.

---

### Live-wall / anon key (investigation answer)

- **Can anon read cross-event data?** **Yes**, via RLS — not limited by live-wall UI filters. App queries filter `event_id`, but PostgREST allows arbitrary queries with the same anon key.  
- **Is anon key exposure risky?** The key itself is expected to be public; **risk is the RLS**, not the key. With current policies, the anon key is effectively a public read API for users, posts, comments, memberships, schedules, and booths.

### Edge Function auth checklist (requested)

| Function | JWT verified | Role check before service role | Notes |
|----------|--------------|--------------------------------|-------|
| delete-user | Yes | Platform admin (non-self) | Pass |
| bulk-create-users | Yes | Platform or event admin | Fail: admin role mint (H2) |
| admin-reset-user-password | Yes | Platform or event + membership | Pass |
| admin-download-post-photo | Yes | Platform/event admin | Pass |
| admin-zip-event-photos | Yes | Platform/event admin | Pass |
| set-event-creator-admin | Yes | Creator only | Pass |
| set-account-active | Yes | Platform or event + membership | Fail: global ban (H1) |
| get-r2-upload-url | Yes | Path/membership authz | Pass |
| upload-image-to-r2 | Yes | Path/membership (except processOnly) | Partial (M6) |
| send-announcement-push | Yes | **None** | Critical (C2) |
| send-registration-setup-email | **No** | N/A (open + registration_open) | High (H3) |
| log-auth-attempt | **No** | N/A | High (H7) |
| Cron jobs | Cron secret (optional) | Service role | High if secret unset (H4) |
