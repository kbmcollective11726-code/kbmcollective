#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}
loadEnv();
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();
const policies = await client.query(`
  SELECT policyname, tablename, roles::text AS roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('users', 'posts', 'comments', 'event_members')
    AND cmd = 'SELECT'
  ORDER BY tablename, policyname`);
console.log('SELECT policies:\n', policies.rows);
const fns = await client.query(`
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE 'get_live_wall%' OR p.proname IN ('list_live_wall_events', 'is_live_wall_event', 'is_event_member'))
  ORDER BY 1`);
console.log('RPCs:\n', fns.rows);
const sample = await client.query(`SELECT public.list_live_wall_events() AS events`);
console.log('list_live_wall_events sample length:', JSON.stringify(sample.rows[0]?.events)?.length);
await client.end();
