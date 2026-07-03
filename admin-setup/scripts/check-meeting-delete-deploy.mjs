async function check(base) {
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
    'Cancel meeting only before the slot ends',
    'remove the slot and booking permanently',
    'Delete slot',
    'Cancelled meetings',
  ];
  console.log('\n', base, m[1], 'bytes', s.length);
  for (const term of terms) console.log(' ', term, s.includes(term));
}

await check('https://cadmin.kbmcollective.org');
