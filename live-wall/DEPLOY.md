# Deploying live-wall

Production: **https://vercel.com/kbmconnects-projects/live-wall**

## Do not use MCP / partial file uploads

Uploading a handful of files to Vercel (Cursor MCP `deploy_to_vercel`) fails with:

`Couldn't find any pages or app directory`

Only `package.json` reaches the builder — the `app/` tree is missing. Use Git or the Vercel CLI instead.

## One-time setup

```powershell
vercel login
```

Use the **kbmcollective11726-code** account on the **kbmconnects-projects** team (same as cadmin).

In Vercel → **live-wall** → **Settings** → **Git**:

- Repo: `kbmcollective11726-code/kbmcollective`
- Production branch: `master`
- Root Directory: `live-wall`

After that, pushes to `master` that touch `live-wall/**` can auto-deploy (if Git integration is enabled).

## Deploy production (manual)

```powershell
cd live-wall
npm run deploy
```

This runs `vercel --prod` from the **repo root** with `--scope kbmconnects-projects --project live-wall`.

## GitHub Actions (optional)

See `.github/workflows/deploy-live-wall.yml`. Add secret `VERCEL_LIVE_WALL_PROJECT_ID` = `prj_JfQzkGjUqdC9wWqWvLGiAikCtgAU` (reuses existing `VERCEL_TOKEN` and `VERCEL_ORG_ID` from cadmin).

## Troubleshooting

| Problem | Fix |
|--------|-----|
| Deployed to wrong team (`omars-projects`) | Log in as kbmcollective11726-code; delete `live-wall/.vercel` if it linked the wrong project |
| `scope-not-accessible` / `Not authorized` | Wrong Vercel account — use KBM team login |
| `invalid token` after login | Unset `VERCEL_TOKEN` in shell / Cursor env |
| Build missing `app/` | Never use partial file upload; use CLI or Git |

## Wall engagement effects (v1–v3)

Effects are on by default. URL toggles:

- `?effects=0` — disable all animations
- `?sound=1` — enable chimes (or use **SOUND ON/OFF** button bottom-right)

Built-in moments: new #1 confetti, like hearts on featured photo, rank-up glow, point milestones, first photo, comment spotlight, photo-of-the-hour badge.
