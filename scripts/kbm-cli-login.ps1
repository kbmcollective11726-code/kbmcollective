# Reset and re-login Supabase + Vercel CLI for KBM CollectiveLive.
# MCP auth is separate (Cursor Settings → MCP) and is already configured.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "`n=== KBM CLI auth reset ===" -ForegroundColor Cyan
Write-Host "Project: Supabase noydhokbswedvltjyenr | Vercel kbmconnects-projects/admin-setup`n"

Write-Host "Current status:" -ForegroundColor Yellow
node (Join-Path $root 'scripts/kbm-auth-status.mjs')

Write-Host "`nLogging out stale CLI sessions..." -ForegroundColor Yellow
Push-Location $root
try {
  npx supabase logout 2>&1 | Out-Host
  npx vercel logout 2>&1 | Out-Host
} finally {
  Pop-Location
}

Write-Host "`n--- Step 1: Vercel (KBMConnect team) ---" -ForegroundColor Green
Write-Host "Sign in with the account that owns KBMConnect's projects on vercel.com"
Push-Location (Join-Path $root 'admin-setup')
try {
  npx vercel login
  npx vercel link --project admin-setup --scope kbmconnects-projects --yes
  npx vercel whoami
  npx vercel teams ls
} finally {
  Pop-Location
}

Write-Host "`n--- Step 2: Supabase (kbmcollective org) ---" -ForegroundColor Green
Write-Host "Sign in with the kbmcollective Supabase org account (CollectiveLive project)"
Push-Location $root
try {
  npx supabase login
  npx supabase link --project-ref noydhokbswedvltjyenr --yes
  npx supabase projects list
} finally {
  Pop-Location
}

Write-Host "`n--- Final check ---" -ForegroundColor Green
node (Join-Path $root 'scripts/kbm-auth-status.mjs')
