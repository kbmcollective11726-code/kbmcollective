# PII retention & purge (ASVS V8)

**Owner:** KBM Connect platform admins  
**Last updated:** 2026-08-01  
**Scope:** Supabase Postgres + Auth + Cloudflare R2

## Inventory (high level)

| Data | Store | Sensitivity |
|------|--------|-------------|
| Account profile (email, name, phone, …) | `public.users` | High |
| Auth credentials / sessions | Supabase Auth | High |
| Event membership & roles | `event_members` | Medium |
| Registration submissions | `event_registration_submissions` (+ answers) | High |
| Feed posts/comments/images | `posts`, `comments`, R2 | Medium–High |
| Push tokens | `users.push_token` (self-only read) | High |
| Login attempts / audit | `auth_login_attempts`, `platform_audit_log` | Medium |
| Chat / meetings | chat + B2B tables | High |

## Retention defaults

| Category | Retention | Action after |
|----------|-----------|--------------|
| `auth_login_attempts` | **90 days** | Automated DELETE |
| `platform_audit_log` | **365 days** (security) | Automated DELETE of older rows (platform admins may export first) |
| Orphan Auth users (no membership, never completed onboarding) | **30 days** after signup | Existing orphan auto-deactivate job; expand to delete when approved |
| Soft-deleted posts (`is_deleted`) | **180 days** | Purge row + R2 object when present |
| Deactivated accounts (`users.is_active = false`) | Keep **1 year** unless user requests erasure | Manual / `delete-user` Edge Function |
| R2 media for deleted users | Immediate on `delete-user` | Already purged in Edge Function |
| Live-wall public display names | While event `live_wall_enabled` | Event flag / event end |

## User rights

- **Access / correction:** in-app profile edit; event admins can update roster fields.
- **Erasure:** platform admin uses **Delete user** (`delete-user` Edge Function) — Auth user + profile + R2 objects.
- **Portability:** export via platform user audit / SQL as needed (document per-request).

## Automated jobs

1. **`purge_expired_security_logs`** — SQL function + nightly `pg_cron` (see migration `20260801180000_pii_retention_purge.sql`).
2. **Orphan processing** — existing `process-orphan-auto-deactivate` / signup alerts (keep enabled; `CRON_SECRET` required).

## Manual checklist (quarterly)

- [ ] Confirm cron jobs running (`cron.job` / verify scripts)
- [ ] Spot-check R2 prefixes for deleted users
- [ ] Review `platform_audit_log` volume vs retention
- [ ] Re-run `/kbm-security-audit`
