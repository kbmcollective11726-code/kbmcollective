import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_JPEG_QUALITY = 0.85;
/** Banners: slightly smaller than 1920 = faster encode + upload; still sharp on phones. */
const BANNER_MAX_WIDTH = 1600;
const BANNER_JPEG_QUALITY = 0.82;
/** Booth logos display small in UI; smaller encode + payload = faster upload. */
const VENDOR_LOGO_MAX_WIDTH = 768;
const VENDOR_LOGO_JPEG_QUALITY = 0.82;

const PRESIGN_REQUEST_TIMEOUT_MS = 25_000;
const R2_PUT_TIMEOUT_MS = 120_000;

export type CompressJpegOptions = { maxWidth?: number; quality?: number };

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
  accessToken: string
): Promise<string | null> {
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-r2-upload-url`;
  const presignAc = new AbortController();
  const presignTimer = setTimeout(() => presignAc.abort(), PRESIGN_REQUEST_TIMEOUT_MS);
  let presignRes: Response;
  try {
    presignRes = await fetch(fnUrl, {
      method: 'POST',
      headers: edgeFunctionHeaders(accessToken),
      body: JSON.stringify({ key: r2Key, contentType: 'image/jpeg' }),
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
      headers: { 'Content-Type': 'image/jpeg' },
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
  accessToken: string
): Promise<string | null> {
  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/upload-image-to-r2`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: edgeFunctionHeaders(accessToken),
      body: JSON.stringify({
        key: r2Key,
        contentType: 'image/jpeg',
        base64,
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

export type EventScopedImageFolder = 'vendor-logos' | 'event-banner' | 'sponsor-logos';

function buildStoragePath(eventId: string, userId: string, folder: EventScopedImageFolder): string {
  if (folder === 'event-banner') return `${eventId}/banner_${Date.now()}.jpg`;
  return `${eventId}/${folder}/${userId}_${Date.now()}.jpg`;
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

  const compressOpts =
    folder === 'event-banner'
      ? { maxWidth: BANNER_MAX_WIDTH, quality: BANNER_JPEG_QUALITY }
      : { maxWidth: VENDOR_LOGO_MAX_WIDTH, quality: VENDOR_LOGO_JPEG_QUALITY }; // vendor + sponsor logos
  const jpegBlob = await compressImageToJpegBlob(file, compressOpts);
  const storagePath = buildStoragePath(eventId, userId, folder);
  const r2Key = buildR2Key(storagePath);
  const buf = await jpegBlob.arrayBuffer();

  const presignedUrl = await tryR2PresignedUpload(buf, r2Key, token);
  if (presignedUrl) return presignedUrl;

  const { data, error } = await supabase.storage.from('event-photos').upload(storagePath, buf, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (!error && data?.path) {
    const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(data.path);
    if (pub?.publicUrl) return pub.publicUrl;
  }

  const base64 = await blobToBase64(jpegBlob);
  const proxyUrl = await tryR2Base64Proxy(base64, r2Key, token);
  if (proxyUrl) return proxyUrl;

  if (error) {
    throw new Error(error.message || 'Storage upload failed. Check bucket policies for event-photos.');
  }
  throw new Error('Upload failed (R2 presign, storage, and proxy all unavailable). Check R2 secrets and network.');
}
