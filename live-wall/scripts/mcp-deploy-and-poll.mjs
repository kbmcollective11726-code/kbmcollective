#!/usr/bin/env node
/**
 * Reads deploy args JSON from stdin, calls Vercel deploy API via MCP-style payload output.
 * This script is used with: node build-mcp-deploy-args.mjs | node mcp-deploy-and-poll.mjs
 * For MCP deploy, the agent calls deploy_to_vercel with the args; this script only validates.
 */
import { readFileSync } from 'fs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const args = JSON.parse(input);
  if (!args.files || args.files.length !== 14) {
    console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    target: args.target,
    name: args.name,
    teamId: args.teamId,
    fileCount: args.files.length,
    fileNames: args.files.map((f) => f.file),
    payloadBytes: Buffer.byteLength(input, 'utf8'),
  }));
});
