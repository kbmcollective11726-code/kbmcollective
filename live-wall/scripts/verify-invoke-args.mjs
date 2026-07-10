#!/usr/bin/env node
/**
 * Reads .mcp-invoke-args.json, verifies 14 files, writes deploy result placeholder.
 * Deploy is invoked by agent via CallMcpTool deploy_to_vercel.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argsPath = join(__dirname, '.mcp-invoke-args.json');
const args = JSON.parse(readFileSync(argsPath, 'utf8'));

if (!args.files || args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  process.exit(1);
}

const out = {
  verified: true,
  fileCount: args.files.length,
  fileNames: args.files.map((f) => f.file),
  target: args.target,
  name: args.name,
  teamId: args.teamId,
  projectSettings: args.projectSettings,
};
writeFileSync(join(__dirname, '.deploy-meta.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
