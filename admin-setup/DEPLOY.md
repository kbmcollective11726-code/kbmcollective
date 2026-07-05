# Deploying connect + cadmin (admin-setup)

Production URLs: **connect.kbmcollective.org**, **cadmin.kbmcollective.org**

## One-time setup

```powershell
cd admin-setup
vercel login
```

Use the **kbmcollective11726-code** account in the KBMConnect team.

## Deploy production (manual)

From **any** folder:

```powershell
cd admin-setup
npm run deploy
```

This script:
- Clears a stale `VERCEL_TOKEN` environment variable (invalid token breaks CLI login)
- Runs Vercel from the **repo root** (project `rootDirectory` is `admin-setup`)

## Why deploys sometimes failed

| Problem | Fix |
|--------|-----|
| `git push` only — no Vercel build | Run `npm run deploy` or enable Git integration in Vercel |
| `invalid token` after `vercel login` | Unset `VERCEL_TOKEN` in shell / Cursor env |
| `admin-setup/admin-setup does not exist` | Deploy from repo root (fixed in `npm run deploy`) |
| `scope-not-accessible` | Log in as the KBMConnect team member |

## Auto-deploy on push (recommended)

1. Vercel → **admin-setup** → **Settings** → **Git** → connect `kbmcollective11726-code/kbmcollective`, production branch **master**, root directory **admin-setup**
2. Or add GitHub Actions secrets (see `.github/workflows/deploy-admin-setup.yml`) and push that workflow

After Git integration, every push to `master` that touches `admin-setup/**` triggers a production deploy automatically.
