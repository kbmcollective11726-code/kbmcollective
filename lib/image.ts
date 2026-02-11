import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64ToArrayBuffer } from 'base64-arraybuffer';
import md5 from 'js-md5';
import { supabase } from './supabase';

const MAX_WIDTH = 1920;
const COMPRESSION_QUALITY = 0.8;

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
 * Resizes to max 1920px wide and compresses to 80% JPEG quality.
 * Typically reduces a 5MB photo to ~300KB.
 */
export async function compressImage(uri: string): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    {
      compress: COMPRESSION_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  if (!manipulated?.uri) {
    return uri;
  }
  return manipulated.uri;
}

/**
 * Compress image and compute MD5 hash of its content (for duplicate detection).
 * Use this before posting so we can store image_hash and prevent duplicate-photo points.
 */
export async function compressAndHashImage(
  uri: string
): Promise<{ compressedUri: string; imageHash: string }> {
  const compressedUri = await compressImage(uri);
  const base64 = await FileSystem.readAsStringAsync(compressedUri, {
    encoding: 'base64',
  });
  const imageHash = (md5 as unknown as (message: string) => string)(base64);
  return { compressedUri, imageHash };
}

/**
 * Upload an image to Supabase Storage.
 * Returns the public URL of the uploaded image.
 */
export async function uploadImage(
  localUri: string,
  eventId: string,
  userId: string,
  bucket: string = 'event-photos',
  options: { skipCompress?: boolean } = {}
): Promise<string | null> {
  try {
    const compressedUri = options.skipCompress
      ? localUri
      : await compressImage(localUri);

    // Read the file as base64 (use string literal; EncodingType can be undefined in bundle)
    const base64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: 'base64',
    });

    // Generate a unique filename
    const timestamp = Date.now();
    const filePath = `${eventId}/${userId}_${timestamp}.jpg`;

    // Convert base64 to ArrayBuffer (React Native / Hermes friendly)
    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new Error('Invalid base64 image data');
    }
    const arrayBuffer = decodeBase64ToArrayBuffer(base64);

    // Upload to Supabase Storage (ArrayBuffer works in RN; Blob not required)
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    const path = data?.path;
    if (!path) {
      console.error('Upload succeeded but no path in response');
      return null;
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('Image upload failed:', err);
    throw err;
  }
}

/**
 * Upload an avatar image.
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
    if (!path) {
      console.error('Avatar upload succeeded but no path in response');
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(path);

    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('Avatar upload failed:', err);
    return null;
  }
}

/**
 * Upload an event banner image. Used for branding the Info screen hero.
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
