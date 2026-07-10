#!/usr/bin/env node
/**
 * Deploy live-wall to Vercel production via MCP deploy_to_vercel using full file payload.
 * Reads .deploy-full-args.json (14 files) and polls until READY or ERROR.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT_ID = 'prj_JfQzkGjUqdC9wWqWvLGiAikCtgAU';
const POLL_MS = 7000;
const MAX_POLL_MS = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const argsPath = join(__dirname, '.deploy-full-args.json');
  const args = JSON.parse(readFileSync(argsPath, 'utf8'));
  if (!args.files || args.files.length !== 14) {
    throw new Error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  }
  console.log(`Deploying ${args.name} (${args.files.length} files, ${args.target})…`);

  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.vercel.com'));
  const client = new Client({ name: 'live-wall-deploy', version: '1.0.0' });
  await client.connect(transport);

  const deployResult = await client.callTool({
    name: 'deploy_to_vercel',
    arguments: args,
  });

  const deployText = deployResult.content
    ?.map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
  console.log('Deploy response:', deployText || JSON.stringify(deployResult));

  let deploymentId = '';
  let deploymentUrl = '';
  const idMatch = deployText?.match(/dpl_[A-Za-z0-9]+/);
  if (idMatch) deploymentId = idMatch[0];
  const urlMatch = deployText?.match(/https:\/\/[^\s]+/);
  if (urlMatch) deploymentUrl = urlMatch[0];

  const started = Date.now();
  let finalState = 'UNKNOWN';
  let buildErrors = [];

  while (Date.now() - started < MAX_POLL_MS) {
    const listResult = await client.callTool({
      name: 'list_deployments',
      arguments: { projectId: PROJECT_ID, teamId: TEAM_ID },
    });
    const listText = listResult.content
      ?.map((c) => (c.type === 'text' ? c.text : ''))
      .join('\n') || '';

    let deployments = [];
    try {
      const jsonStart = listText.indexOf('[');
      const jsonObjStart = listText.indexOf('{');
      const sliceStart = jsonStart >= 0 ? jsonStart : jsonObjStart;
      if (sliceStart >= 0) {
        const parsed = JSON.parse(listText.slice(sliceStart));
        deployments = Array.isArray(parsed) ? parsed : parsed.deployments || [];
      }
    } catch {
      // fallback: regex for state near deployment id
    }

    const target = deploymentId
      ? deployments.find((d) => d.id === deploymentId || d.uid === deploymentId)
      : deployments[0];

    if (target) {
      deploymentId = target.id || target.uid || deploymentId;
      deploymentUrl = target.url ? (target.url.startsWith('http') ? target.url : `https://${target.url}`) : deploymentUrl;
      finalState = (target.state || target.readyState || 'UNKNOWN').toUpperCase();
      console.log(`Poll: ${deploymentId} → ${finalState}`);
      if (finalState === 'READY' || finalState === 'ERROR' || finalState === 'CANCELED') break;
    } else {
      console.log('Poll: waiting for deployment to appear…');
    }

    await sleep(POLL_MS);
  }

  if (finalState === 'ERROR' && deploymentId) {
    const logsResult = await client.callTool({
      name: 'get_deployment_build_logs',
      arguments: { idOrUrl: deploymentId, teamId: TEAM_ID, errorsOnly: true },
    });
    const logsText = logsResult.content
      ?.map((c) => (c.type === 'text' ? c.text : ''))
      .join('\n') || '';
    buildErrors = logsText.split('\n').filter((l) => l.trim());
    console.log('Build errors:', logsText.slice(0, 4000));
  }

  const summary = {
    deploymentId,
    url: deploymentUrl,
    state: finalState,
    buildErrors,
  };
  console.log('\n=== DEPLOY SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  await client.close();
  process.exit(finalState === 'READY' ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
