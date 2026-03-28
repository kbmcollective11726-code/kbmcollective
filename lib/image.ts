import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64ToArrayBuffer } from 'base64-arraybuffer';
import md5 from 'js-md5';
import Toast from 'react-native-toast-message';
import { supabase, supabaseStorage, supabaseUrl } from './supabase';

const MAX_WIDTH = 1920;
const MAX_WIDTH_POST = 1280;
/** Vendor booth logos: keep uploads small (faster R2 / storage). */
const MAX_WIDTH_VENDOR_LOGO = 768;
const COMPRESSION_QUALITY = 0.8;
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
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert('Photo library access is needed to select photos');
      return null;
    }
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        });

  if (result.canceled || !result.assets?.[0]) return null;

  return result.assets[0].uri;
}

/**
 * Compress an image to reduce file size before uploading.
 */
export async function compressImage(
  uri: string,
  maxWidth: number = MAX_WIDTH,
  quality: number = COMPRESSION_QUALITY
): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  if (!manipulated?.uri) {
    return uri;
  }
  return manipulated.uri;
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

/** Android: when true, try direct R2 (presigned URL + upload) like iOS. Set via EXPO_PUBLIC_ANDROID_USE_R2=true in .env, or ANDROID_USE_R2_DEV in dev. */
const ANDROID_USE_R2_DEV = true; // Set to true in dev to test R2 when .env/extra isn't passed (e.g. Expo Go)
const extraR2 = (Constants.expoConfig as { extra?: { ANDROID_USE_R2?: string } } | null)?.extra?.ANDROID_USE_R2;
const envR2 = process.env.EXPO_PUBLIC_ANDROID_USE_R2;
const ANDROID_USE_R2_DIRECT =
  Platform.OS === 'android' &&
  (extraR2 === 'true' || envR2 === 'true' || (__DEV__ && ANDROID_USE_R2_DEV));
const ANDROID_STORAGE_ONLY = Platform.OS === 'android' && !ANDROID_USE_R2_DIRECT;
if (__DEV__ && Platform.OS === 'android') {
  console.log('[image] Android upload: R2 direct=', ANDROID_USE_R2_DIRECT, '| extra=', extraR2, '| env=', envR2);
}

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
  timeoutMs: number
): Promise<R2UrlResult> {
  /* Use main supabase client so session is always in sync (fixes Android 401 when R2 URL requested). */
  let session: { access_token?: string } | null = null;
  try {
    const sessionResult = await withTimeout(
      supabase.auth.getSession(),
      GET_SESSION_TIMEOUT_MS,
      'Getting session'
    );
    session = sessionResult?.data?.session ?? null;
  } catch (_) {
    return { ok: false, message: 'Session timeout' };
  }
  if (!session?.access_token) {
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
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ key, contentType }),
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
 * Call get-r2-upload-url Edge Function. On Android we use direct fetch + AbortController so the request
 * cannot hang; on iOS we use supabase.functions.invoke().
 */
async function getR2UploadUrl(key: string, contentType: string): Promise<R2UrlResult> {
  if (Platform.OS === 'android') {
    const hardTimeoutMs = EDGE_FUNCTION_TIMEOUT_MS + 5_000;
    const result = await Promise.race([
      getR2UploadUrlViaFetch(key, contentType, EDGE_FUNCTION_TIMEOUT_MS),
      new Promise<R2UrlResult>((_, rej) =>
        setTimeout(() => rej(new Error(`Get URL timed out after ${hardTimeoutMs / 1000}s`)), hardTimeoutMs)
      ),
    ]).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    return result;
  }
  const result = await supabase.functions.invoke('get-r2-upload-url', {
    body: { key, contentType },
  });
  type InvokeBody = { uploadUrl?: string; publicUrl?: string; error?: string } | null;
  type InvokeError = { message?: string; status?: number } | null;
  const data = result.data as InvokeBody;
  const error = result.error as InvokeError;
  if (error) {
    const msg = error.message ?? String(error);
    const status = error.status;
    return { ok: false, status, message: msg };
  }
  const body = data;
  if (!body) return { ok: false, message: 'No response' };
  if (body.error && String(body.error).includes('R2 not configured')) {
    return { ok: false, status: 503, message: body.error };
  }
  if (body.error) return { ok: false, status: 401, message: body.error };
  if (!body.uploadUrl || !body.publicUrl) return { ok: false, message: 'Missing upload URL' };
  return { ok: true, uploadUrl: body.uploadUrl, publicUrl: body.publicUrl };
}

/** Result of trying R2: either the public URL or a failure reason for fallback/UI. */
type R2UploadResult = { url: string } | { failed: true; reason: string };

const R2_PROXY_TIMEOUT_MS = 60_000;

/**
 * Upload image to R2 via Edge Function proxy (app sends base64, function uploads to R2).
 * Used on Android so the app only talks to Supabase; images still end up on R2.
 */
async function uploadToR2ViaProxy(
  key: string,
  base64: string,
  contentType: string
): Promise<R2UploadResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { failed: true, reason: 'Not signed in' };
  }
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/upload-image-to-r2`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), R2_PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ key, contentType, base64 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    type ProxyResponse = { publicUrl?: string; error?: string } | null;
    let body: ProxyResponse = null;
    try {
      body = text ? (JSON.parse(text) as { publicUrl?: string; error?: string }) : null;
    } catch {
      return { failed: true, reason: res.ok ? 'Invalid response' : (text?.slice(0, 150) || `HTTP ${res.status}`) };
    }
    if (!res.ok) {
      const reason = body && typeof body === 'object' ? (body.error ?? String(body)) : `HTTP ${res.status}`;
      return { failed: true, reason };
    }
    if (!body?.publicUrl) {
      return { failed: true, reason: 'No URL in response' };
    }
    return { url: body.publicUrl };
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return { failed: true, reason: isAbort ? `Upload timed out after ${R2_PROXY_TIMEOUT_MS / 1000}s` : msg };
  }
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
      getR2UploadUrl(key, contentType),
      EDGE_FUNCTION_TIMEOUT_MS + 10_000,
      'Getting upload URL'
    );
    if (!urlResult.ok && Platform.OS === 'android') {
      await new Promise((r) => setTimeout(r, 2000));
      urlResult = await withTimeout(
        getR2UploadUrl(key, contentType),
        EDGE_FUNCTION_TIMEOUT_MS + 5_000,
        'Getting upload URL (retry)'
      );
    }
    if (!urlResult.ok) {
      const reason = urlResult.status ? `${urlResult.status}: ${urlResult.message}` : urlResult.message;
      if (Platform.OS === 'android') {
        console.warn('[R2 Android] Get URL failed:', reason);
      }
      return { failed: true, reason: `R2 URL: ${reason}` };
    }

    if (Platform.OS === 'android' && fileUri) {
      const uploadType = (FileSystem as { FileSystemUploadType?: { BINARY_CONTENT: number } }).FileSystemUploadType?.BINARY_CONTENT ?? 0;
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
      console.warn('[R2 Android] FileSystem.uploadAsync failed:', status || (uploadResult as { _error?: unknown })._error);
      const putRes = await withTimeout(
        fetch(urlResult.uploadUrl, {
          method: 'PUT',
          body: arrayBuffer,
          headers: { 'Content-Type': contentType },
        }),
        R2_PUT_TIMEOUT_MS,
        'Uploading to R2 (retry)'
      ).catch((e) => null);
      if (putRes?.ok) return { url: urlResult.publicUrl };
      if (putRes && !putRes.ok) {
        return { failed: true, reason: `R2 PUT: ${putRes.status}` };
      }
      const errMsg = (uploadResult as { _error?: unknown })._error;
      return { failed: true, reason: errMsg instanceof Error ? errMsg.message : 'R2 upload failed' };
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
      if (Platform.OS === 'android') {
        console.warn('[R2 Android] PUT failed:', putRes.status, putRes.statusText);
      }
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
 * Upload an image: tries R2 first (saves Supabase egress), then falls back to Supabase Storage.
 * Returns the public URL of the uploaded image.
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

    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new Error('Invalid base64 image data');
    }
    const arrayBuffer = decodeBase64ToArrayBuffer(base64);

    let r2FileUri: string | undefined = Platform.OS === 'android' ? uploadFileUri : undefined;
    if (Platform.OS === 'android' && r2FileUri && r2FileUri.startsWith('content://')) {
      const cachePath = `${FileSystem.cacheDirectory ?? ''}r2_upload_${timestamp}.jpg`;
      try {
        await FileSystem.copyAsync({ from: r2FileUri, to: cachePath });
        r2FileUri = cachePath;
      } catch (_) {
        r2FileUri = uploadFileUri;
      }
    }

    // Android: Supabase Storage only (like original). Use supabaseStorage so custom fetch doesn't affect upload.
    if (Platform.OS === 'android' && ANDROID_STORAGE_ONLY) {
      const { data, error } = await supabaseStorage.storage
        .from(bucket)
        .upload(filePath, arrayBuffer, { contentType: 'image/jpeg', upsert: false });
      if (error) {
        const msg = (error as { message?: string }).message ?? String(error);
        throw new Error(msg || 'Storage upload failed');
      }
      const path = data?.path;
      if (!path) throw new Error('Storage returned no path');
      const { data: urlData } = supabaseStorage.storage.from(bucket).getPublicUrl(path);
      return urlData?.publicUrl ?? null;
    }

    const STORAGE_UPLOAD_TIMEOUT_MS = Platform.OS === 'android' ? 75_000 : 45_000;
    const storageClient = Platform.OS === 'android' ? supabaseStorage : supabase;
    const doUpload = async (): Promise<string | null> => {
      const r2Result = await uploadToR2(
        `event-photos/${filePath}`,
        arrayBuffer,
        'image/jpeg',
        Platform.OS === 'android' ? r2FileUri : undefined
      );
      if (!('failed' in r2Result)) return r2Result.url;
      try {
        Toast.show({
          type: 'info',
          text1: 'Saved to app storage',
          text2: `R2 unavailable: ${r2Result.reason}`,
          visibilityTime: 5000,
        });
      } catch (_) {}

      const { data, error } = await withTimeout(
        storageClient.storage.from(bucket).upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: false,
        }),
        STORAGE_UPLOAD_TIMEOUT_MS,
        'Uploading to storage'
      );

      if (error) {
        const msg = (error as { message?: string }).message ?? String(error);
        throw new Error(msg || 'Storage upload failed');
      }
      const path = data?.path;
      if (!path) throw new Error('Storage returned no path');
      const { data: urlData } = storageClient.storage.from(bucket).getPublicUrl(path);
      return urlData?.publicUrl ?? null;
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
    const compressedUri = await compressImage(localUri);
    const base64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: 'base64',
    });
    const filePath = `${eventId}/banner_${Date.now()}.jpg`;
    const arrayBuffer = decodeBase64ToArrayBuffer(base64);

    const r2Result = await uploadToR2(`event-photos/${filePath}`, arrayBuffer, 'image/jpeg');
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
