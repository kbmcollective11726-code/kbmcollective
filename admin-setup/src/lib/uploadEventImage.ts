import { supabase, supabaseUrl } from './supabase';

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_JPEG_QUALITY = 0.85;
/** Booth logos display small in UI; smaller encode + payload = faster Edge upload. */
const VENDOR_LOGO_MAX_WIDTH = 768;
const VENDOR_LOGO_JPEG_QUALITY = 0.82;

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

function buildStoragePath(eventId: string, userId: string, folder: string): string {
  return `${eventId}/${folder}/${userId}_${Date.now()}.jpg`;
}

function buildR2Key(storagePath: string): string {
  return `event-photos/${storagePath}`;
}

/**
 * Upload booth logo like the mobile app: R2 via Edge Function, then Supabase Storage.
 */
export async function uploadEventImage(file: File, eventId: string, folder: 'vendor-logos'): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) {
    throw new Error('Sign in required to upload images.');
  }
  const userId = session.user.id;
  const jpegBlob = await compressImageToJpegBlob(file, {
    maxWidth: VENDOR_LOGO_MAX_WIDTH,
    quality: VENDOR_LOGO_JPEG_QUALITY,
  });
  const storagePath = buildStoragePath(eventId, userId, folder);
  const r2Key = buildR2Key(storagePath);
  const base64 = await blobToBase64(jpegBlob);

  const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/upload-image-to-r2`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
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
      /* ignore */
    }
    if (res.ok && body.publicUrl) {
      return body.publicUrl;
    }
  } catch (e) {
    console.warn('upload-image-to-r2 fetch failed:', e);
  }

  const buf = await jpegBlob.arrayBuffer();
  const { data, error } = await supabase.storage.from('event-photos').upload(storagePath, buf, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) {
    throw new Error(error.message || 'Storage upload failed. Check bucket policies for event-photos.');
  }
  if (!data?.path) throw new Error('Upload returned no path');
  const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(data.path);
  if (!pub?.publicUrl) throw new Error('Could not get public URL');
  return pub.publicUrl;
}
