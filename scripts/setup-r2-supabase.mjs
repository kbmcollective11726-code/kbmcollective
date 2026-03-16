#!/usr/bin/env node
/**
 * Set Supabase Edge Function secrets for R2 and deploy get-r2-upload-url.
 * Run from project root. Requires: npx supabase (Supabase CLI), project linked.
 *
 * Usage:
 *   Set env vars then: node scripts/setup-r2-supabase.mjs
 *   Or run and paste values when prompted.
 */
import { execSync } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function getEnv(name) {
  return (process.env[name] ?? '').trim();
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer ?? '').trim());
    });
  });
}

function escapeEnvValue(v) {
  if (v.includes('"') || v.includes('\n') || v.includes('\\')) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }
  return /[\s#]/.test(v) ? `"${v}"` : v;
}

async function main() {
  let accountId = getEnv('R2_ACCOUNT_ID');
  let accessKeyId = getEnv('R2_ACCESS_KEY_ID');
  let secretAccessKey = getEnv('R2_SECRET_ACCESS_KEY');
  let bucketName = getEnv('R2_BUCKET_NAME') || 'collectivelive-images';
  let publicUrl = getEnv('R2_PUBLIC_URL');

  if (!accountId) accountId = await prompt('R2_ACCOUNT_ID (e.g. aac994fdcde128cf893654b7bb405cfc): ');
  if (!accessKeyId) accessKeyId = await prompt('R2_ACCESS_KEY_ID (from Cloudflare R2 API token): ');
  if (!secretAccessKey) secretAccessKey = await prompt('R2_SECRET_ACCESS_KEY (from Cloudflare R2 API token): ');
  if (!bucketName) bucketName = (await prompt('R2_BUCKET_NAME [collectivelive-images]: ')) || 'collectivelive-images';
  if (!publicUrl) publicUrl = await prompt('R2_PUBLIC_URL (e.g. https://pub-d1210b28e4ce468a898decd45c5e7820.r2.dev): ');

  const missing = [];
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucketName) missing.push('R2_BUCKET_NAME');
  if (!publicUrl) missing.push('R2_PUBLIC_URL');

  if (missing.length) {
    console.error('Missing:', missing.join(', '));
    process.exit(1);
  }

  publicUrl = publicUrl.replace(/\/$/, '');

  const envContent = [
    `R2_ACCOUNT_ID=${escapeEnvValue(accountId)}`,
    `R2_ACCESS_KEY_ID=${escapeEnvValue(accessKeyId)}`,
    `R2_SECRET_ACCESS_KEY=${escapeEnvValue(secretAccessKey)}`,
    `R2_BUCKET_NAME=${escapeEnvValue(bucketName)}`,
    `R2_PUBLIC_URL=${escapeEnvValue(publicUrl)}`,
  ].join('\n');

  const envFile = path.join(projectRoot, '.env.r2.secrets');
  try {
    fs.writeFileSync(envFile, envContent, 'utf8');
    console.log('Setting Supabase Edge Function secrets...');
    execSync('npx supabase secrets set --env-file .env.r2.secrets', {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    console.log('Secrets set.');
  } catch (e) {
    console.error('Failed to set secrets:', e.message);
    process.exit(1);
  } finally {
    try { fs.unlinkSync(envFile); } catch (_) {}
  }

  console.log('Deploying get-r2-upload-url...');
  try {
    execSync('npx supabase functions deploy get-r2-upload-url', { stdio: 'inherit', cwd: projectRoot });
    console.log('Done. New image uploads will use R2.');
  } catch (e) {
    console.error('Deploy failed:', e.message);
    process.exit(1);
  }
}

main();
