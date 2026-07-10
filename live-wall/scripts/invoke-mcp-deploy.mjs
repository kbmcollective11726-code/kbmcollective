#!/usr/bin/env node
/**
 * Reads deploy-payload-slim.json and prints MCP deploy_to_vercel arguments as JSON to stdout.
 * Used to pass the full file tree to the Vercel MCP deploy tool.
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
process.stdout.write(JSON.stringify(args));
