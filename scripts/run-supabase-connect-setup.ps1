# Reads Supabase CLI OAuth token from Windows Credential Manager and runs connect setup.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$env:SUPABASE_ACCESS_TOKEN = (
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/get-supabase-cli-token.ps1') -Target supabase
).Trim()
node scripts/supabase-connect-setup.mjs
