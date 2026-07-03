async function check(base) {
  const h = await fetch(base);
  const t = await h.text();
  const m = t.match(/assets\/(index-[^"]+\.js)/);
  if (!m) {
    console.log(base, 'no js bundle found');
    return;
  }
  const j = await fetch(`${base.replace(/\/$/, '')}/assets/${m[1]}`);
  const s = await j.text();
  const has = s.includes('event-admin-tiles');
  console.log(base, has ? 'YES — tile page deployed' : 'NO — tile page not in build');
}

await check('https://cadmin.kbmcollective.org');
await check('https://admin-setup-blue.vercel.app');
