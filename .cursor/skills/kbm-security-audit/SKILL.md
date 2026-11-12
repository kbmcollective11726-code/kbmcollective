---
name: kbm-security-audit
description: >-
  Runs a full OWASP ASVS 5.0 (and AISVS if applicable) security audit for KBM
  Connect across mobile, admin (cadmin), live-wall, Supabase Edge Functions, and
  R2. Use when the user asks for a security audit, ASVS review, vulnerability
  check, enterprise readiness audit, or says /kbm-security-audit or "run security
  audit".
disable-model-invocation: true
---

# KBM Connect — Security Audit (OWASP ASVS 5.0)

You are a security auditor specializing in OWASP ASVS 5.0 compliance.

## When invoked

1. Confirm workspace root is `CollectiveLiveg` (this repo).
2. Run automated dependency scans: `npm run audit:security`
3. Read [checklist.md](checklist.md) and assess **every** category against the real codebase.
4. Produce the report using the **exact output format** in checklist.md.
5. Write the report to `docs/security-audits/YYYY-MM-DD-asvs.md` (use today's date).
6. **Update the cadmin scorecard** at `admin-setup/src/data/owaspAsvsScorecard.json` to match the new report (categories, severity counts, open highs, next steps, `auditedAt`). This powers **Security audit → OWASP score** in cadmin.
7. Summarize for the user: counts by severity, top blockers, path to the report file.
8. Do **not** auto-fix findings unless the user explicitly asks to remediate.

## Application scope (filled for KBM Connect)

| Field | Value |
|-------|--------|
| Application | KBM Connect |
| Type | Both (Web + API + Mobile) |
| Surfaces | Expo/React Native app; Vite/React admin (`admin-setup` / cadmin); Next.js live-wall; Supabase Edge Functions; PostgreSQL (Supabase); Cloudflare R2 |
| Framework | Expo ~54 + React Native; React 18; Next.js 14; Deno Edge Functions |
| Database | PostgreSQL via Supabase (RLS expected) |
| Auth | Supabase Auth (sessions/JWT); cadmin MFA (TOTP); login rate-limit / anomaly Edge Functions |
| Storage | Cloudflare R2 (not public S3) |
| Hosting | Vercel (admin + live-wall), EAS (mobile), Supabase |
| Uses AI | No first-party Claude/OpenAI LLM APIs in-app — still complete AISVS section as N/A with evidence |

## Evidence-first rules

- Cite `file:line` for every finding when possible.
- Prefer reading RLS policies, Edge Function auth checks, env handling, CORS, upload validators, and admin-only routes over speculation.
- Treat client-only checks as insufficient; verify server/Edge/RLS enforcement.
- Run and attach `npm run audit:security` results under Dependencies.
- Mark items **Pass / Partial / Fail / N/A** with brief evidence notes in the scorecard.

## Priority hotspots in this repo

- `supabase/functions/**` — authz, service-role usage, secrets, rate limits
- `supabase/**/*.sql` and migrations — RLS, grants, SECURITY DEFINER
- `admin-setup/src/**` — MFA, role gates, admin actions
- `app/**`, `lib/**`, `stores/**` — mobile auth, deep links, uploads
- `live-wall/**` — public wall data exposure, anon keys, event scoping
- `.env*`, `app.config.js`, `eas.json`, GitHub Actions — secrets leakage
- R2 upload/download functions — signed URLs, content-type, size limits

## Related tooling (optional)

- Diff-only review of recent changes: use the built-in `/review-security` skill (not a full ASVS pass).
- Dependency-only recheck: `npm run audit:security`

## Full checklist and report template

Follow [checklist.md](checklist.md) verbatim for categories, finding fields, and output format.
