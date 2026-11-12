import fs from 'fs';
import path from 'path';

const names = [
  'auto-deactivate-events',
  'get-r2-upload-url',
  'normalize-event-banner',
  'process-scheduled-announcements',
  'upload-image-to-r2',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function writeRetry(file, src) {
  for (let i = 0; i < 8; i++) {
    try {
      fs.writeFileSync(file, src);
      return;
    } catch (e) {
      if (i === 7) throw e;
      await sleep(400 * (i + 1));
    }
  }
}

for (const name of names) {
  const file = path.join('supabase/functions', name, 'index.ts');
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('headers: Record<string, string>')) {
    console.log('ok', name);
    continue;
  }

  src = src.replace(
    /function json\(body: unknown, status = 200\) \{\r?\n  return new Response\(JSON\.stringify\(body\), \{\r?\n    status,\r?\n    headers: \{ "Content-Type": "application\/json", \.\.\.ch \},\r?\n  \}\);\r?\n\}/,
    `function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}`,
  );

  src = src.replace(/return json\(([\s\S]*?), (\d+)\);/g, (full, body, status) => {
    if (full.includes(', ch)')) return full;
    return `return json(${body}, ${status}, ch);`;
  });

  await writeRetry(file, src);
  console.log('fixed', name);
}
