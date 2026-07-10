#!/usr/bin/env node
/**
 * Invokes deploy_to_vercel via Vercel MCP by reading full args JSON from stdin or file.
 * Usage: node invoke-mcp-deploy-call.mjs live-wall/scripts/.mcp-tool-args.json
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argsPath = process.argv[2] || join(__dirname, '.mcp-tool-args.json');
const args = JSON.parse(readFileSync(argsPath, 'utf8'));

if (!args.files || args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  process.exit(1);
}

// Output marker + compact summary for agent; full args remain in file for MCP tooling.
console.log('MCP_DEPLOY_ARGS_FILE', argsPath);
console.log(JSON.stringify({
  target: args.target,
  name: args.name,
  teamId: args.teamId,
  projectSettings: args.projectSettings,
  fileCount: args.files.length,
  filePaths: args.files.map((f) => f.file),
}));
