import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64ToArrayBuffer } from 'base64-arraybuffer';
import md5 from 'js-md5';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { EVENT_BANNER_HEIGHT, EVENT_BANNER_WIDTH } from './eventBanner';
import { useAuthStore } from '../stores/authStore';

const MAX_WIDTH = 1920;
const MAX_WIDTH_POST = 1080;
/** Vendor booth logos: keep uploads small (faster R2 / storage). */
const MAX_WIDTH_VENDOR_LOGO = 768;
const COMPRESSION_QUALITY = 0.75;
const VENDOR_LOGO_QUALITY = 0.82;
const ANDROID_POST_MAX_WIDTH = 1024;
const ANDROID_POST_QUALITY = 0.75;

/** Reject after ms with a clear message so uploads don't spin forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s. Check your connection and try again.`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Open the camera or photo library and return the selected image URI.
 */
export async function pickImage(
  source: 'camera' | 'library' = 'library'
): Promise<string | null> {
  // Request permission
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      alert('Camera permission is needed to take photos');
      return null;
    }
  } else if (Platform.OS === 'ios') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert('Photo library access is needed to select photos');
      return null;
    }
  }
  /* Android: system photo picker — no READ_MEDIA_IMAGES / READ_MEDIA_VIDEO (Google Play policy). */

  const libraryBase: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
  };
  const libraryOpts: ImagePicker.ImagePickerOptions =
    Platform.OS === 'ios'
      ? {
          ...libraryBase,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        }
      : libraryBase;
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync(libraryOpts);

  if (result.canceled || !result.assets?.[0]) return null;

  return result.assets[0].uri;
}

/**
 * Copy picker/camera URI to app cache so `manipulateAsync` does not share the same asset as `<Image/>`.
 * Fixes iOS "Calling renderAsync has failed" / "Image context has been lost" on screenshots and library picks.
 */
async function stableUriForImageManipulator(uri: string): Promise<string> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return uri;
  const pathOnly = uri.split('?')[0] ?? uri;
  const extMatch = pathOnly.match(/\.(jpe?g|png|heic|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace(/^jpeg$/i, 'jpg') : 'jpg';
  const dest = `${cacheDir}img_manip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

/**
 * Compress an image to reduce file size before uploading.
 * Never throws: if expo-image-manipulator fails (iOS "Image context has been lost"), returns a stable cache copy for upload.
 */
export async function compressImage(
  uri: string,
  maxWidth: number = MAX_WIDTH,
  quality: number = COMPRESSION_QUALITY
): Promise<string> {
  const saveOpts = {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  } as const;

  const tryManipulate = async (src: string, actions: ImageManipulator.Action[]) => {
    const manipulated = await ImageManipulator.manipulateAsync(src, actions, saveOpts);
    if (!manipulated?.uri) return null;
    return manipulated.uri;
  };

  const smallWidth = Math.min(maxWidth, 1024);
  const actionSets: ImageManipulator.Action[][] = [
    [{ resize: { width: maxWidth } }],
    [{ resize: { width: smallWidth } }],
    [],
  ];

  async function runAllOnSource(src: string): Promise<string | null> {
    for (const actions of actionSets) {
      try {
        const out = await tryManipulate(src, actions);
        if (out) return out;
      } catch {
        /* next */
      }
    }
    return null;
  }

  const primarySrc = await stableUriForImageManipulator(uri);
  const fromPrimary = await runAllOnSource(primarySrc);
  if (fromPrimary) return fromPrimary;

  const cacheDir = FileSystem.cacheDirectory;
  if (cacheDir) {
    const dest = `${cacheDir}img_manip_retry_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
    try {
      await FileSystem.copyAsync({ from: uri, to: dest });
      const fromRetry = await runAllOnSource(dest);
      if (fromRetry) return fromRetry;
    } catch {
      /* fall through */
    }
  }

  return primarySrc;
}

const BANNER_JPEG_QUALITY = 0.82;

/** Light JPEG compress before server letterbox — do not resize (edge function letterboxes to 1200×750). */
export async function compressEventBanner(uri: string): Promise<string> {
  const saveOpts = {
    compress: BANNER_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  } as const;

  const primarySrc = await stableUriForImageManipulator(uri);

  let width = EVENT_BANNER_WIDTH;
  let height = EVENT_BANNER_HEIGHT;
  try {
    const probe = await ImageManipulator.manipulateAsync(primarySrc, [], saveOpts);
    if (probe.width && probe.height) {
      width = probe.width;
      height = probe.height;
    }
  } catch {
    /* use defaults */
  }

  const maxEdge = Math.max(width, height);
  if (maxEdge <= EVENT_BANNER_WIDTH) {
    try {
      const result = await ImageManipulator.manipulateAsync(primarySrc, [], saveOpts);
      if (result?.uri) return result.uri;
    } catch {
      /* fall through */
    }
    return primarySrc;
  }

  const scale = EVENT_BANNER_WIDTH / maxEdge;
  const newWidth = Math.max(1, Math.round(width * scale));
  try {
    const result = await ImageManipulator.manipulateAsync(
      primarySrc,
      [{ resize: { width: newWidth } }],
      saveOpts
    );
    if (result?.uri) return result.uri;
  } catch {
    /* fall through */
  }

  return primarySrc;
}

/**
 * Compress image and compute MD5 hash (for duplicate detection).
 * On Android uses smaller size + lower quality so upload finishes in ~20–30s.
 */
export async function compressAndHashImage(
  uri: string,
  options: { maxWidth?: number; quality?: number } = {}
): Promise<{ compressedUri: string; imageHash: string; base64: string }> {
  const maxWidth = options.maxWidth ?? (Platform.OS === 'android' ? ANDROID_POST_MAX_WIDTH : MAX_WIDTH_POST);
  const quality = options.quality ?? (Platform.OS === 'android' ? ANDROID_POST_QUALITY : COMPRESSION_QUALITY);
  const compressedUri = await compressImage(uri, maxWidth, quality);
  const base64 = await FileSystem.readAsStringAsync(compressedUri, {
    encoding: 'base64',
  });
  const imageHash = (md5 as unknown as (message: string) => string)(base64);
  return { compressedUri, imageHash, base64 };
}

const EDGE_FUNCTION_TIMEOUT_MS = Platform.OS === 'android' ? 30_000 : 18_000;
const R2_PUT_TIMEOUT_MS = Platform.OS === 'android' ? 60_000 : 35_000;
const UPLOAD_TOTAL_TIMEOUT_MS = Platform.OS === 'android' ? 100_000 : 65_000;

type R2UrlResult =
  | { ok: true; uploadUrl: string; publicUrl: string }
  | { ok: false; status?: number; message: string };

/**
 * Call get-r2-upload-url Edge Function via direct fetch with AbortController.
 * Used on Android where supabase.functions.invoke() can hang; fetch + abort guarantees we don't spin forever.
 */
const GET_SESSION_TIMEOUT_MS = Platform.OS === 'android' ? 6_000 : 5_000;

async function getR2UploadUrlViaFetch(
  key: string,
  contentType: string,
  contentLength: number,
  timeoutMs: number
): Promise<R2UrlResult> {
  // Prefer the session already held by the auth store. Calling getSession while
  // many page requests are queued can block the upload even though the user is
  // already authenticated.
  const cachedSession = useAuthStore.getState().session as {
    access_token?: string;
  } | null;
  let accessToken = cachedSession?.access_token;
  if (!accessToken) {
    try {
      const sessionResult = await withTimeout(
        supabase.auth.getSession(),
        GET_SESSION_TIMEOUT_MS,
        'Getting session'
      );
      accessToken = sessionResult?.data?.session?.access_token;
    } catch (_) {
      return { ok: false, message: 'Session timeout' };
    }
  }
  if (!accessToken) {
    return { ok: false, status: 401, message: 'Not signed in' };
  }
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-r2-upload-url`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ key, contentType, contentLength }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    type R2UrlBody = { uploadUrl?: string; publicUrl?: string; error?: string; message?: string };
    let body: R2UrlBody | null = null;
    try {
      body = text ? (JSON.parse(text) as R2UrlBody) : null;
    } catch {
      if (!res.ok) return { ok: false, status: res.status, message: text?.slice(0, 200) || res.statusText || `HTTP ${res.status}` };
      return { ok: false, message: 'Invalid response from server' };
    }
    if (!res.ok) {
      const msg = (body?.error ?? body?.message ?? res.statusText ?? `HTTP ${res.status}`) as string;
      return { ok: false, status: res.status, message: msg };
    }
    if (!body) return { ok: false, message: 'No response' };
    if (body.error && String(body.error).includes('R2 not configured')) {
      return { ok: false, status: 503, message: body.error };
    }
    if (body.error) return { ok: false, status: 401, message: body.error };
    if (!body.uploadUrl || !body.publicUrl) return { ok: false, message: 'Missing upload URL' };
    return { ok: true, uploadUrl: body.uploadUrl, publicUrl: body.publicUrl };
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return { ok: false, message: isAbort ? `Request timed out after ${timeoutMs / 1000}s` : msg };
  }
}

/**
 * Call get-r2-upload-url Edge Function via direct fetch + AbortController on all
 * platforms. supabase.functions.invoke() has hung on iOS during Share → Uploading.
 */
async function getR2UploadUrl(
  key: string,
  contentType: string,
  contentLength: number
): Promise<R2UrlResult> {
  const hardTimeoutMs = EDGE_FUNCTION_TIMEOUT_MS + 5_000;
  return Promise.race([
    getR2UploadUrlViaFetch(key, contentType, contentLength, EDGE_FUNCTION_TIMEOUT_MS),
    new Promise<R2UrlResult>((_, rej) =>
      setTimeout(() => rej(new Error(`Get URL timed out after ${hardTimeoutMs / 1000}s`)), hardTimeoutMs)
    ),
  ]).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
}

/** Result of trying R2: either the public URL or a failure reason for fallback/UI. */
type R2UploadResult = { url: string } | { failed: true; reason: string };

const R2_PROXY_TIMEOUT_MS = Platform.OS === 'android' ? 60_000 : 45_000;

type EdgeImageResponse = { publicUrl?: string; base64?: string; error?: string };

async function callUploadImageEdge(body: Record<string, unknown>): Promise<EdgeImageResponse | null> {
  const accessToken = useAuthStore.getState().session?.access_token;
  if (!accessToken || !supabaseUrl) return null;
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/upload-image-to-r2`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), R2_PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    try {
      const parsed = text ? (JSON.parse(text) as EdgeImageResponse) : null;
      if (!res.ok && parsed?.error) return parsed;
      if (!res.ok) return { error: text?.slice(0, 150) || `HTTP ${res.status}` };
      return parsed;
    } catch {
      return res.ok ? null : { error: text?.slice(0, 150) || `HTTP ${res.status}` };
    }
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return { error: isAbort ? `Upload timed out after ${R2_PROXY_TIMEOUT_MS / 1000}s` : msg };
  }
}

/** Letterbox to 1200×750 on the server (matches cadmin). Returns JPEG base64. */
async function letterboxBannerBase64ViaEdge(base64: string): Promise<string | null> {
  const body = await callUploadImageEdge({
    base64,
    transform: 'event-banner',
    processOnly: true,
  });
  const out = body?.base64;
  return typeof out === 'string' && out.length > 0 ? out : null;
}

/**
 * Upload image to R2 via Edge Function proxy (app sends base64, function uploads to R2).
 * Used on Android so the app only talks to Supabase; images still end up on R2.
 */
async function uploadToR2ViaProxy(
  key: string,
  base64: string,
  contentType: string,
  transform?: 'event-banner'
): Promise<R2UploadResult> {
  const body = await callUploadImageEdge({
    key,
    contentType,
    base64,
    ...(transform ? { transform } : {}),
  });
  if (!body) {
    return { failed: true, reason: 'Upload request failed' };
  }
  if (body.error) {
    return { failed: true, reason: body.error };
  }
  if (!body.publicUrl) {
    return { failed: true, reason: 'No URL in response' };
  }
  return { url: body.publicUrl };
}

/**
 * Upload image to R2 via presigned URL. Returns URL or failure reason.
 * On Android we use FileSystem.uploadAsync (native) so the PUT cannot hang like fetch does.
 */
async function uploadToR2(
  key: string,
  arrayBuffer: ArrayBuffer,
  contentType: string = 'image/jpeg',
  fileUri?: string
): Promise<R2UploadResult> {
  try {
    let urlResult = await withTimeout(
      getR2UploadUrl(key, contentType, arrayBuffer.byteLength),
      EDGE_FUNCTION_TIMEOUT_MS + 10_000,
      'Getting upload URL'
    );
    if (!urlResult.ok) {
      await new Promise((r) => setTimeout(r, 1500));
      urlResult = await withTimeout(
        getR2UploadUrl(key, contentType, arrayBuffer.byteLength),
        EDGE_FUNCTION_TIMEOUT_MS + 5_000,
        'Getting upload URL (retry)'
      );
    }
    if (!urlResult.ok) {
      const reason = urlResult.status ? `${urlResult.status}: ${urlResult.message}` : urlResult.message;
      return { failed: true, reason: `R2 URL: ${reason}` };
    }

    // Native file PUT on both platforms — fetch(ArrayBuffer) has hung on iOS
    // leaving Share stuck on "Uploading…".
    if (fileUri) {
      const uploadType =
        (FileSystem as { FileSystemUploadType?: { BINARY_CONTENT: number } }).FileSystemUploadType
          ?.BINARY_CONTENT ?? 0;
      const uploadResult = await withTimeout(
        FileSystem.uploadAsync(urlResult.uploadUrl, fileUri, {
          httpMethod: 'PUT',
          uploadType: uploadType as 0,
          headers: { 'Content-Type': contentType },
        }),
        R2_PUT_TIMEOUT_MS,
        'Uploading to R2'
      ).catch((e) => ({ status: 0, _error: e }));
      const status = (uploadResult as { status?: number }).status ?? 0;
      if (status >= 200 && status < 300) {
        return { url: urlResult.publicUrl };
      }
      if (__DEV__) {
        console.warn(
          '[R2] FileSystem.uploadAsync failed:',
          status || (uploadResult as { _error?: unknown })._error
        );
      }
      const putRes = await withTimeout(
        fetch(urlResult.uploadUrl, {
          method: 'PUT',
          body: arrayBuffer,
          headers: { 'Content-Type': contentType },
        }),
        R2_PUT_TIMEOUT_MS,
        'Uploading to R2 (retry)'
      ).catch(() => null);
      if (putRes?.ok) return { url: urlResult.publicUrl };
      if (putRes && !putRes.ok) {
        return { failed: true, reason: `R2 PUT: ${putRes.status}` };
      }
      const errMsg = (uploadResult as { _error?: unknown })._error;
      return {
        failed: true,
        reason: errMsg instanceof Error ? errMsg.message : 'R2 upload failed',
      };
    }

    const putRes = await withTimeout(
      fetch(urlResult.uploadUrl, {
        method: 'PUT',
        body: arrayBuffer,
        headers: { 'Content-Type': contentType },
      }),
      R2_PUT_TIMEOUT_MS,
      'Uploading to storage'
    );
    if (!putRes.ok) {
      return { failed: true, reason: `R2 PUT: ${putRes.status}` };
    }
    return { url: urlResult.publicUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    if (Platform.OS === 'android') {
      console.warn('[R2 Android] Error:', isAbort ? 'timeout' : msg);
    }
    return { failed: true, reason: isAbort ? `Upload timed out after ${R2_PUT_TIMEOUT_MS / 1000}s` : msg };
  }
}

/**
 * Upload an event image: Cloudflare R2 first (primary), then Supabase Storage backup.
 * Android: Edge proxy first (device → Supabase → R2), then direct presigned PUT.
 * iOS: direct presigned PUT first, then Edge proxy.
 * Pass options.base64 when you already have it (e.g. from compressAndHashImage) to avoid reading the file again.
 */
export async function uploadImage(
  localUri: string,
  eventId: string,
  userId: string,
  bucket: string = 'event-photos',
  options: { skipCompress?: boolean; base64?: string; folder?: string; maxWidth?: number; quality?: number } = {}
): Promise<string | null> {
  try {
    let base64: string;
    let uploadFileUri: string = localUri;
    if (options.base64 != null && options.base64.length > 0) {
      base64 = options.base64;
    } else {
      const logo = options.folder === 'vendor-logos';
      const maxW = options.maxWidth ?? (logo ? MAX_WIDTH_VENDOR_LOGO : MAX_WIDTH);
      const qual = options.quality ?? (logo ? VENDOR_LOGO_QUALITY : COMPRESSION_QUALITY);
      uploadFileUri = options.skipCompress
        ? localUri
        : await compressImage(localUri, maxW, qual);
      base64 = await FileSystem.readAsStringAsync(uploadFileUri, {
        encoding: 'base64',
      });
    }

    const timestamp = Date.now();
    const filePath = options.folder
      ? `${eventId}/${options.folder}/${userId}_${timestamp}.jpg`
      : `${eventId}/${userId}_${timestamp}.jpg`;
    const r2Key = `event-photos/${filePath}`;

    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new Error('Invalid base64 image data');
    }
    const arrayBuffer = decodeBase64ToArrayBuffer(base64);
    // Reject non-JPEG payloads client-side (R2 authz also checks magic bytes on proxy).
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error('Only JPEG images can be uploaded');
    }

    const doUpload = async (): Promise<string> => {
      const reasons: string[] = [];

      const tryProxy = async (): Promise<string | null> => {
        const result = await uploadToR2ViaProxy(r2Key, base64, 'image/jpeg');
        if (!('failed' in result)) return result.url;
        reasons.push(`proxy: ${result.reason}`);
        return null;
      };

      const tryDirect = async (): Promise<string | null> => {
        const result = await uploadToR2(r2Key, arrayBuffer, 'image/jpeg', uploadFileUri);
        if (!('failed' in result)) return result.url;
        reasons.push(`direct: ${result.reason}`);
        return null;
      };

      // Direct native PUT first on both platforms (fast path). Proxy next for
      // networks that block Cloudflare R2. iOS used to prefer proxy-first, but
      // large base64 posts hung Share on "Uploading…".
      const viaDirect = await tryDirect();
      if (viaDirect) return viaDirect;
      const viaProxy = await tryProxy();
      if (viaProxy) return viaProxy;

      // Backup only after R2 paths fail — keep posts working on venue Wi‑Fi.
      const { data, error } = await supabase.storage.from(bucket).upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (!error && data?.path) {
        if (__DEV__) console.warn('[uploadImage] R2 failed; used Supabase backup:', reasons.join('; '));
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
        if (urlData?.publicUrl) return urlData.publicUrl;
      }
      if (error) reasons.push(`supabase: ${error.message}`);

      throw new Error(
        `Photo upload failed. ${reasons.join('; ') || 'Unknown error'}. Check your connection and try again.`
      );
    };

    return withTimeout(doUpload(), UPLOAD_TOTAL_TIMEOUT_MS, 'Photo upload');
  } catch (err) {
    console.error('Image upload failed:', err);
    throw err;
  }
}

/**
 * Upload an avatar image. Tries R2 first, then Supabase Storage.
 */
export async function uploadAvatar(
  localUri: string,
  userId: string
): Promise<string | null> {
  try {
    const compressedUri = await compressImage(localUri);
    const base64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: 'base64',
    });
    const filePath = `${userId}/avatar_${Date.now()}.jpg`;
    const arrayBuffer = decodeBase64ToArrayBuffer(base64);

    const r2Result = await uploadToR2(`avatars/${filePath}`, arrayBuffer, 'image/jpeg');
    if (!('failed' in r2Result)) return r2Result.url;

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Avatar upload error:', error);
      return null;
    }

    const path = data?.path;
    if (!path) return null;

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('Avatar upload failed:', err);
    return null;
  }
}

/**
 * Upload an event banner image. Tries R2 first, then Supabase Storage.
 * Path: event-photos/{eventId}/banner_{timestamp}.jpg
 */
export async function uploadEventBanner(
  localUri: string,
  eventId: string,
  bucket: string = 'event-photos'
): Promise<string | null> {
  try {
    const compressedUri = await compressEventBanner(localUri);
    const rawBase64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: 'base64',
    });
    const filePath = `${eventId}/banner_${Date.now()}.jpg`;
    const r2Key = `event-photos/${filePath}`;

    const letterboxedBase64 = await letterboxBannerBase64ViaEdge(rawBase64);
    if (!letterboxedBase64) {
      console.error('Banner letterbox failed');
      return null;
    }

    const proxyResult = await uploadToR2ViaProxy(r2Key, letterboxedBase64, 'image/jpeg');
    if (!('failed' in proxyResult)) return proxyResult.url;

    const arrayBuffer = decodeBase64ToArrayBuffer(letterboxedBase64);
    const r2Result = await uploadToR2(r2Key, arrayBuffer, 'image/jpeg');
    if (!('failed' in r2Result)) return r2Result.url;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Banner upload error:', error);
      return null;
    }

    const path = data?.path;
    if (!path) return null;

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('Banner upload failed:', err);
    return null;
  }
}

/**
 * Get a thumbnail URL using Supabase image transformations.
 * This generates a smaller version of the image on the fly.
 */
export function getThumbnailUrl(
  originalUrl: string,
  width: number = 400,
  height: number = 400
): string {
  // Supabase Storage supports image transformations via URL params
  if (originalUrl.includes('supabase.co/storage')) {
    return `${originalUrl}?width=${width}&height=${height}&resize=cover`;
  }
  return originalUrl;
}
