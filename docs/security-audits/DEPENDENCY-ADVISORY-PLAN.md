# Dependency advisory plan (ASVS V11)

Last reviewed: 2026-08-01 (hardening pass + Next 15 attempt)

## Done
- **admin-setup `react-router`**: kept on **6.30.4** (React 18 Vite SPA) until React 19.
- **live-wall**: targeting **Next 15 LTS** (from 14.2.35). Validate wall rotation/sponsors after deploy.
- **Mobile Expo**: remain on **Expo SDK 54** for this pass.

## Expo SDK majors (deferred — dedicated session)
- npm audit still wants **Expo 57** for Metro/postcss highs.
- Do **not** force `npm audit fix --force` on mobile in a hotfix window.
- Plan: schedule SDK 55→56→57 upgrade with EAS preview builds + regression on auth, push, R2 upload, SecureStore sessions.

## live-wall Next
- After Next 15 is green in production, evaluate Next 16 only if remaining advisories require it.
- Do not jump 14→16 in one step.

## Mobile remaining highs (accepted until SDK bump)
- `postcss` via Metro
- `sharp` (image pipeline)

## Tracking
Re-run: `npm run audit:security` after each bump.
