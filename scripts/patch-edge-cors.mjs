import fs from 'fs';
import path from 'path';

const root = 'supabase/functions';
const dirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'));

let patched = 0;
for (const d of dirs) {
  const file = path.join(root, d.name, 'index.ts');
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('Access-Control-Allow-Origin')) continue;
  if (src.includes('_shared/cors.ts')) {
    console.log('skip', d.name);
    continue;
  }

  const hasLogSecret = src.includes('x-log-auth-secret');
  const extra = hasLogSecret
    ? 'Authorization, Content-Type, apikey, x-log-auth-secret'
    : 'Authorization, Content-Type, apikey';

  src = src.replace(/const corsHeaders = \{[\s\S]*?\};\r?\n\r?\n/, '');

  if (src.includes('edge-runtime.d.ts')) {
    src = src.replace(
      /(import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\r?\n)/,
      `$1import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";\n`,
    );
  } else {
    src =
      `import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";\n` + src;
  }

  src = src.replace(
    /if \(req\.method === "OPTIONS"\) \{\s*return new Response\(null, \{ headers: corsHeaders \}\);\s*\}/g,
    `if (req.method === "OPTIONS") {\n    return corsPreflightResponse(req, "${extra}");\n  }`,
  );
  src = src.replace(
    /if \(req\.method === "OPTIONS"\) return new Response\(null, \{ headers: corsHeaders \}\);/g,
    `if (req.method === "OPTIONS") return corsPreflightResponse(req, "${extra}");`,
  );

  if (src.includes('Deno.serve(async (req')) {
    src = src.replace(
      /Deno\.serve\(async \(req: Request\) => \{/,
      `Deno.serve(async (req: Request) => {\n  const ch = corsHeaders(req, "${extra}");`,
    );
    src = src.replace(/\.\.\.corsHeaders/g, '...ch');
    src = src.replace(/headers: corsHeaders([,\}])/g, 'headers: ch$1');
  }

  fs.writeFileSync(file, src);
  patched++;
  console.log('patched', d.name);
}
console.log('total', patched);
