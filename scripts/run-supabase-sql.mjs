#!/usr/bin/env node
/**
 * Run Supabase SQL file(s) against the remote database.
 * Requires DATABASE_URL in .env (Supabase Dashboard → Project Settings → Database → Connection string → URI).
 *
 * Usage:
 *   npm run supabase:run-sql              → runs supabase/ENSURE-ALL-TABLES.sql
 *   npm run supabase:fix-recursion        → runs supabase/FIX-GROUP-RECURSION.sql
 *   SUPABASE_SQL_FILE=supabase/foo.sql node scripts/run-supabase-sql.mjs
 *   node scripts/run-supabase-sql.mjs supabase/FIX-GROUP-RECURSION.sql
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

loadEnv();
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL or SUPABASE_DB_URL in .env');
  console.error('Get it from: Supabase Dashboard → Project Settings → Database → Connection string (URI)');
  process.exit(1);
}

const fileArg = process.env.SUPABASE_SQL_FILE || process.argv[2];
const defaultFile = 'supabase/ENSURE-ALL-TABLES.sql';
const relativePath = fileArg || defaultFile;
const sqlPath = join(root, relativePath);

if (!existsSync(sqlPath)) {
  console.error('SQL file not found:', sqlPath);
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');
const label = relativePath.replace(/^supabase[/\\]/, '');

async function run() {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(sql);
    console.log('SQL ran successfully (' + label + ').');
  } catch (err) {
    console.error('Error running SQL:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
