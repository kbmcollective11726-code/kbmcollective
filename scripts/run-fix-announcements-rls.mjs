#!/usr/bin/env node
/**
 * Run scripts/fix-announcements-rls.sql against your Supabase database.
 * Requires: .env with SUPABASE_URL and SUPABASE_DB_PASSWORD (from Dashboard → Settings → Database).
 * Run: node scripts/run-fix-announcements-rls.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const envPath = resolve(__dirname, '..', '.env');
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      process.env[k] = v;
    }
  }
} catch (e) {
  console.warn('Could not load .env:', e.message);
}

const supabaseUrl = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD_RAW;

if (!supabaseUrl) {
  console.error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL in .env');
  process.exit(1);
}
if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD in .env. Get it from: Supabase Dashboard → Project Settings → Database → Database password');
  process.exit(1);
}

// Direct connection: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
const projectRef = supabaseUrl.split('.')[0];
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

const sqlPath = resolve(__dirname, 'fix-announcements-rls.sql');
const sql = readFileSync(sqlPath, 'utf8');

async function main() {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query(sql);
    console.log('Announcements RLS policies updated successfully.');
  } catch (err) {
    console.error('Error running SQL:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
