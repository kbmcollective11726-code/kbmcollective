#!/usr/bin/env node
/**
 * Deploy live-wall via Vercel MCP HTTP endpoint using args JSON file.
 * Reads deploy args and calls deploy_to_vercel through @modelcontextprotocol/sdk.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argsPath = process.argv[2] || join(__dirname, '.mcp-tool-args.json');
const args = JSON.parse(readFileSync(argsPath, 'utf8'));

if (!args.files || args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL('https://mcp.vercel.com'));
const client = new Client({ name: 'live-wall-deploy', version: '1.0.0' });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'deploy_to_vercel',
    arguments: {
      target: args.target,
      name: args.name,
      teamId: args.teamId,
      projectSettings: args.projectSettings,
      files: args.files,
    },
  });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('MCP deploy failed:', err?.message || err);
  process.exit(1);
} finally {
  await client.close();
}
