#!/usr/bin/env node
/**
 * Uses Supabase CLI token from Windows Credential Manager (same store as `supabase login`).
 */
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ps1 = join(__dirname, 'get-supabase-cli-token.ps1');

function getToken() {
  const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  if (!out.startsWith('sbp_')) {
    throw new Error('Supabase CLI token not found or invalid format.');
  }
  return out;
}

export { getToken };
