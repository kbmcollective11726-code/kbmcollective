async function probe(base) {
  const r = await fetch(base, { redirect: 'follow' });
  const html = await r.text();
  const m = html.match(/assets\/(index-[^"]+\.js)/);
  const out = { url: base, http: r.status, bundle: m?.[1] ?? null };
  if (m) {
    const js = await (await fetch(`${base.replace(/\/$/, '')}/assets/${m[1]}`)).text();
    out.eventAdminTiles = js.includes('event-admin-tiles');
    out.inAppMenuInEdit = js.includes('In-app menu (mobile)');
    out.platformMenuCols = js.includes('platform_menu_show_agenda');
    out.eventAdminMenuHelper = js.includes('eventAdminMenuUpdateFromForm');
  }
  return out;
}

const bases = [
  'https://cadmin.kbmcollective.org',
  'https://admin-setup-2gpq3paxi-kbmconnects-projects.vercel.app',
];
for (const base of bases) {
  console.log(JSON.stringify(await probe(base), null, 2));
}
