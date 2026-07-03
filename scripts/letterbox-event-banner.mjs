/**
 * Letterbox one event banner to 1200×750 and update events.banner_url.
 * Needs EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * Usage: node scripts/letterbox-event-banner.mjs <event_id>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const W = 1200;
const H = 750;
const BG = { r: 12, g: 31, b: 61, alpha: 1 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env', 'admin-setup/.env']) {
    const p = resolve(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

loadEnv();

const url =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const eventId = process.argv[2];
if (!eventId) {
  console.error('Usage: node scripts/letterbox-event-banner.mjs <event_id>');
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error('Need SUPABASE URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { data: event, error: evErr } = await supabase
  .from('events')
  .select('id, name, banner_url')
  .eq('id', eventId)
  .single();
if (evErr || !event?.banner_url) {
  console.error('Event or banner not found:', evErr?.message);
  process.exit(1);
}

const res = await fetch(event.banner_url);
if (!res.ok) {
  console.error('Download failed:', res.status);
  process.exit(1);
}
const input = Buffer.from(await res.arrayBuffer());
const meta = await sharp(input).metadata();
const iw = meta.width ?? W;
const ih = meta.height ?? H;
const scale = Math.min(W / iw, H / ih);
const drawW = Math.round(iw * scale);
const drawH = Math.round(ih * scale);
const padTop = Math.floor((H - drawH) / 2);
const padBottom = H - drawH - padTop;
const padLeft = Math.floor((W - drawW) / 2);
const padRight = W - drawW - padLeft;

const jpeg = await sharp(input)
  .resize(drawW, drawH, { fit: 'fill' })
  .extend({
    top: padTop,
    bottom: padBottom,
    left: padLeft,
    right: padRight,
    background: BG,
  })
  .jpeg({ quality: 82 })
  .toBuffer();

const outMeta = await sharp(jpeg).metadata();
if (outMeta.width !== W || outMeta.height !== H) {
  console.error('Output size wrong:', outMeta.width, outMeta.height);
  process.exit(1);
}

const storagePath = `${eventId}/banner_${Date.now()}.jpg`;
const { error: upErr } = await supabase.storage.from('event-photos').upload(storagePath, jpeg, {
  contentType: 'image/jpeg',
  upsert: false,
});
if (upErr) {
  console.error('Upload failed:', upErr.message);
  process.exit(1);
}

const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(storagePath);
const publicUrl = pub?.publicUrl;
if (!publicUrl) {
  console.error('No public URL');
  process.exit(1);
}

const { error: updErr } = await supabase
  .from('events')
  .update({ banner_url: publicUrl, updated_at: new Date().toISOString() })
  .eq('id', eventId);
if (updErr) {
  console.error('DB update failed:', updErr.message);
  process.exit(1);
}

console.log(`OK ${event.name}: ${publicUrl} (${W}×${H})`);
