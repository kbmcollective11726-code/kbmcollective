const base = 'https://cadmin.kbmcollective.org';
const html = await fetch(base).then((r) => r.text());
const m = html.match(/assets\/(index-[^"]+\.js)/);
if (!m) {
  console.log('no bundle');
  process.exit(1);
}
const js = await fetch(`${base}/assets/${m[1]}`).then((r) => r.text());
const cssUrl = html.match(/assets\/(index-[^"]+\.css)/)?.[1];
const css = cssUrl ? await fetch(`${base}/assets/${cssUrl}`).then((r) => r.text()) : '';

console.log('bundle:', m[1]);
console.log('PAGE_SIZE 50 in JS:', /PAGE_SIZE\s*=\s*50/.test(js));
console.log('bulkBtn uses surface bg in CSS:', /bulkBtn[\s\S]*?background:\s*var\(--color-surface\)/.test(css));
console.log('admin-download-post-photo in JS:', js.includes('admin-download-post-photo'));
console.log('admin-zip-event-photos in JS:', js.includes('admin-zip-event-photos'));
