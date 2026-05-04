#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const root = resolve(process.cwd());
const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
  console.error('.env missing');
  process.exit(1);
}

const envText = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
}

const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const r = await client.query(
    "select decrypted_secret::text as secret from vault.decrypted_secrets where name = 'cron_secret' limit 1"
  );
  const secret = r.rows?.[0]?.secret;
  if (!secret) {
    console.error('vault cron_secret not found');
    process.exit(1);
  }

  let next = envText;
  if (/^\s*CRON_SECRET\s*=.*$/m.test(next)) {
    next = next.replace(/^\s*CRON_SECRET\s*=.*$/m, `CRON_SECRET=${secret}`);
  } else {
    next = next.replace(/\s*$/, '\n') + `CRON_SECRET=${secret}\n`;
  }
  writeFileSync(envPath, next);
  console.log('CRON_SECRET synced to .env');
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  await client.end();
}
