async function inspect(base) {
  const h = await fetch(base);
  const t = await h.text();
  const m = t.match(/assets\/(index-[^"]+\.js)/);
  if (!m) {
    console.log(base, 'no bundle');
    return;
  }
  const j = await fetch(`${base.replace(/\/$/, '')}/assets/${m[1]}`);
  const s = await j.text();
  const terms = [
    'event-admin-tiles',
    'agenda-print',
    'Edit event',
    'Event admin tiles',
    'EVENT_ADMIN_CONSOLE',
  ];
  console.log('\n', base, m[1], 'bytes', s.length);
  for (const term of terms) console.log(' ', term, s.includes(term));
}

await inspect('https://cadmin.kbmcollective.org');
await inspect('https://admin-setup-blue.vercel.app');

const fs = await import('fs');
const p = new URL('../dist/assets/', import.meta.url);
const f = fs.readdirSync(p).find((x) => x.endsWith('.js'));
const s = fs.readFileSync(new URL(f, p), 'utf8');
console.log('\n local', f, 'bytes', s.length);
for (const term of [
  'event-admin-tiles',
  'agenda-print',
  'Edit event',
  'Event admin tiles',
]) {
  console.log(' ', term, s.includes(term));
}
