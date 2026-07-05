import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { BADGE_BANNER_HEIGHT, BADGE_BANNER_WIDTH } from './badgeBannerHints';
import {
  EVENT_BANNER_HEIGHT,
  EVENT_BANNER_LETTERBOX_BG,
  EVENT_BANNER_WIDTH,
} from './eventBannerHints';

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_JPEG_QUALITY = 0.85;
/** Banners: max width on upload — keeps aspect ratio (May 2026 behavior). */
const BANNER_MAX_WIDTH = 1600;
const BANNER_JPEG_QUALITY = 0.82;
/** Booth logos display small in UI; smaller encode + payload = faster upload. */
const VENDOR_LOGO_MAX_WIDTH = 768;
const VENDOR_LOGO_JPEG_QUALITY = 0.82;

const PRESIGN_REQUEST_TIMEOUT_MS = 25_000;
const R2_PUT_TIMEOUT_MS = 120_000;

export type CompressJpegOptions = { maxWidth?: number; quality?: number };

/**
 * Resize to PNG in the browser — preserves transparency (logos).
 */
export async function compressImageToPngBlob(file: File, opts?: CompressJpegOptions): Promise<Blob> {
  const MAX_WIDTH = opts?.maxWidth ?? VENDOR_LOGO_MAX_WIDTH;
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read this image. Try JPG or PNG.');
  });
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const scale = w > MAX_WIDTH ? MAX_WIDTH / w : 1;
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
        'image/png',
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Average color from corners/edges of the source artwork (for seamless letterbox fill). */
function sampleBitmapEdgeColor(bitmap: ImageBitmap): string {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d');
  if (!ctx) return EVENT_BANNER_LETTERBOX_BG;
  ctx.drawImage(bitmap, 0, 0);
  const w = bitmap.width;
  const h = bitmap.height;
  const points: [number, number][] = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), 0],
    [Math.floor(w / 2), h - 1],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of points) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    r += d[0] ?? 0;
    g += d[1] ?? 0;
    b += d[2] ?? 0;
  }
  const n = points.length;
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

/** Fit badge header to full width (3.75″ at 300 DPI); letterbox top/bottom only if shorter than strip. */
export async function compressBadgeBannerToJpegBlob(
  file: File,
  quality: number = BANNER_JPEG_QUALITY,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read this image. Try JPG or PNG.');
  });
  try {
    const cw = BADGE_BANNER_WIDTH;
    const ch = BADGE_BANNER_HEIGHT;
    const scale = cw / bitmap.width;
    const drawW = cw;
    const drawH = Math.round(bitmap.height * scale);
    const fill = sampleBitmapEdgeColor(bitmap);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, cw, ch);

    if (drawH <= ch) {
      const dy = Math.round((ch - drawH) / 2);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, dy, drawW, drawH);
    } else {
      const srcH = ch / scale;
      const srcY = (bitmap.height - srcH) / 2;
      ctx.drawImage(bitmap, 0, srcY, bitmap.width, srcH, 0, 0, drawW, ch);
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
        'image/jpeg',
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Letterbox into 1200×750 — uniform scale, edge-matched fill (never stretch or crop). */
export async function compressBannerToJpegBlob(
  file: File,
  quality: number = BANNER_JPEG_QUALITY,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read this image. Try JPG or PNG.');
  });
  try {
    const cw = EVENT_BANNER_WIDTH;
    const ch = EVENT_BANNER_HEIGHT;
    const scale = Math.min(cw / bitmap.width, ch / bitmap.height);
    const drawW = Math.round(bitmap.width * scale);
    const drawH = Math.round(bitmap.height * scale);
    const dx = Math.round((cw - drawW) / 2);
    const dy = Math.round((ch - drawH) / 2);
    const fill =
      Math.abs(drawW - cw) < 2 && Math.abs(drawH - ch) < 2
        ? EVENT_BANNER_LETTERBOX_BG
        : sampleBitmapEdgeColor(bitmap);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bitmap, dx, dy, drawW, drawH);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
        'image/jpeg',
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Resize/compress to JPEG in the browser (similar to mobile compressImage).
 */
export async function compressImageToJpegBlob(file: File, opts?: CompressJpegOptions): Promise<Blob> {
  const MAX_WIDTH = opts?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const JPEG_QUALITY = opts?.quality ?? DEFAULT_JPEG_QUALITY;
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read this image. Try JPG or PNG.');
  });
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const scale = w > MAX_WIDTH ? MAX_WIDTH / w : 1;
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(bitmap, 0, 0, cw, ch);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  } finally {
    bitmap.close();
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result as string;
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    fr.onerror = () => reject(new Error('Read failed'));
    fr.readAsDataURL(blob);
  });
}

/**
 * Same path as the mobile app: presigned URL + binary PUT to R2 (no base64 JSON through Edge).
 */
async function tryR2PresignedUpload(
  arrayBuffer: ArrayBuffer,
  r2Key: string,
  accessToken: string,
  contentType: string,
): Promise<string | null> {
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-r2-upload-url`;
  const presignAc = new AbortController();
  const presignTimer = setTimeout(() => presignAc.abort(), PRESIGN_REQUEST_TIMEOUT_MS);
  let presignRes: Response;
  try {
    presignRes = await fetch(fnUrl, {
      method: 'POST',
      headers: edgeFunctionHeaders(accessToken),
      body: JSON.stringify({ key: r2Key, contentType }),
      signal: presignAc.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(presignTimer);
  }

  const text = await presignRes.text();
  let body: { uploadUrl?: string; publicUrl?: string; error?: string } = {};
  try {
    body = text ? (JSON.parse(text) as { uploadUrl?: string; publicUrl?: string; error?: string }) : {};
  } catch {
    return null;
  }
  if (!presignRes.ok || !body.uploadUrl || !body.publicUrl) {
    return null;
  }

  const putAc = new AbortController();
  const putTimer = setTimeout(() => putAc.abort(), R2_PUT_TIMEOUT_MS);
  try {
    const putRes = await fetch(body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: arrayBuffer,
      signal: putAc.signal,
    });
    if (!putRes.ok) return null;
    return body.publicUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(putTimer);
  }
}

async function tryR2Base64Proxy(
  base64: string,
  r2Key: string,
  accessToken: string,
  contentType: string,
  transform?: 'event-banner',
): Promise<string | null> {
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/upload-image-to-r2`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: edgeFunctionHeaders(accessToken),
      body: JSON.stringify({
        key: r2Key,
        contentType,
        base64,
        ...(transform ? { transform } : {}),
      }),
    });
    const text = await res.text();
    let body: { publicUrl?: string; error?: string } = {};
    try {
      body = text ? (JSON.parse(text) as { publicUrl?: string; error?: string }) : {};
    } catch {
      return null;
    }
    if (res.ok && body.publicUrl) return body.publicUrl;
  } catch (e) {
    console.warn('upload-image-to-r2 fetch failed:', e);
  }
  return null;
}

export type EventScopedImageFolder =
  | 'vendor-logos'
  | 'event-banner'
  | 'badge-banner'
  | 'portal-banner'
  | 'sponsor-logos';

function buildStoragePath(eventId: string, userId: string, folder: EventScopedImageFolder): string {
  if (folder === 'event-banner') return `${eventId}/banner_${Date.now()}.jpg`;
  if (folder === 'badge-banner') return `${eventId}/badge_banner_${Date.now()}.jpg`;
  if (folder === 'portal-banner') return `${eventId}/portal_banner_${Date.now()}.jpg`;
  return `${eventId}/${folder}/${userId}_${Date.now()}.png`;
}

function isLogoFolder(folder: EventScopedImageFolder): boolean {
  return folder === 'vendor-logos' || folder === 'sponsor-logos';
}

function buildR2Key(storagePath: string): string {
  return `event-photos/${storagePath}`;
}

/**
 * Upload event-scoped image: R2 via presigned binary PUT (fast), then Storage, then base64 Edge proxy.
 */
export async function uploadEventImage(file: File, eventId: string, folder: EventScopedImageFolder): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) {
    throw new Error('Sign in required to upload images.');
  }
  const userId = session.user.id;
  const token = session.access_token;

  const logoFolder = isLogoFolder(folder);
  const imageBlob =
    folder === 'badge-banner' || folder === 'portal-banner'
      ? await compressBadgeBannerToJpegBlob(file, BANNER_JPEG_QUALITY)
      : folder === 'event-banner'
      ? await compressImageToJpegBlob(file, {
          maxWidth: BANNER_MAX_WIDTH,
          quality: BANNER_JPEG_QUALITY,
        })
      : logoFolder
        ? await compressImageToPngBlob(file, { maxWidth: VENDOR_LOGO_MAX_WIDTH })
        : await compressImageToJpegBlob(file, {
            maxWidth: VENDOR_LOGO_MAX_WIDTH,
            quality: VENDOR_LOGO_JPEG_QUALITY,
          });
  const contentType = logoFolder ? 'image/png' : 'image/jpeg';
  const storagePath = buildStoragePath(eventId, userId, folder);
  const r2Key = buildR2Key(storagePath);
  const buf = await imageBlob.arrayBuffer();

  const presignedUrl = await tryR2PresignedUpload(buf, r2Key, token, contentType);
  if (presignedUrl) return presignedUrl;

  const { data, error } = await supabase.storage.from('event-photos').upload(storagePath, buf, {
    contentType,
    upsert: false,
  });
  if (!error && data?.path) {
    const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(data.path);
    if (pub?.publicUrl) return pub.publicUrl;
  }

  const base64 = await blobToBase64(imageBlob);
  const proxyUrl = await tryR2Base64Proxy(
    base64,
    r2Key,
    token,
    contentType,
    folder === 'event-banner' ? 'event-banner' : undefined,
  );
  if (proxyUrl) return proxyUrl;

  if (error) {
    throw new Error(error.message || 'Storage upload failed. Check bucket policies for event-photos.');
  }
  throw new Error('Upload failed (R2 presign, storage, and proxy all unavailable). Check R2 secrets and network.');
}

/** Re-letterbox via server (1200×750) so the app hero fills without cropping. */
export async function normalizeExistingBannerFromUrl(
  _bannerUrl: string,
  eventId: string,
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sign in required');
  }
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/normalize-event-banner`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: edgeFunctionHeaders(session.access_token),
    body: JSON.stringify({ event_id: eventId }),
  });
  const text = await res.text();
  let body: { banner_url?: string; error?: string } = {};
  try {
    body = text ? (JSON.parse(text) as { banner_url?: string; error?: string }) : {};
  } catch {
    throw new Error(res.ok ? 'Invalid response' : text.slice(0, 200) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(body.error || `Re-fit failed (${res.status})`);
  }
  if (!body.banner_url) {
    throw new Error('No banner URL returned');
  }
  return body.banner_url;
}
