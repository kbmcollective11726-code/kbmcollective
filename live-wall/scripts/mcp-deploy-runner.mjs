#!/usr/bin/env node
/**
 * Reads deploy-payload-slim.json and prints deploy_to_vercel MCP arguments to stdout.
 * Run: node scripts/mcp-deploy-runner.mjs > scripts/.mcp-args.json
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(readFileSync(join(__dirname, 'deploy-payload-slim.json'), 'utf8'));

const args = {
  target: payload.target,
  name: payload.name,
  teamId: payload.teamId,
  projectSettings: payload.projectSettings,
  files: payload.files,
};

if (args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files.length}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(args));
