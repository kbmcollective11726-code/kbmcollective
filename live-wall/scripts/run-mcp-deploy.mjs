#!/usr/bin/env node
/**
 * Reads deploy args from .mcp-deploy-call.json and prints a marker + JSON result path.
 * Actual MCP call is made by the agent via CallMcpTool; this script validates payload.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argsPath = join(__dirname, '.mcp-deploy-call.json');
const args = JSON.parse(readFileSync(argsPath, 'utf8'));

if (!args.files || args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  process.exit(1);
}

const required = [
  'app/layout.tsx',
  'app/page.tsx',
  'app/wall/page.tsx',
  'app/wall/WallPageContent.tsx',
];
const paths = new Set(args.files.map((f) => f.file));
for (const r of required) {
  if (!paths.has(r)) {
    console.error(`Missing required file: ${r}`);
    process.exit(1);
  }
}

writeFileSync(join(__dirname, '.deploy-ready.json'), JSON.stringify(args), 'utf8');
console.log('DEPLOY_ARGS_READY', argsPath, 'files=', args.files.length);
