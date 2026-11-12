/**
 * Auth session storage: SecureStore on native (encrypted), AsyncStorage on web.
 * Large session blobs are split across SecureStore keys (2KB value limit).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SupportedStorage } from '@supabase/supabase-js';

const CHUNK = 1800;

function chunkKey(key: string, i: number) {
  return `${key}__${i}`;
}

async function secureSet(key: string, value: string): Promise<void> {
  const parts = Math.ceil(value.length / CHUNK) || 1;
  await SecureStore.setItemAsync(`${key}__n`, String(parts));
  for (let i = 0; i < parts; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  // Clear any leftover older chunks
  for (let i = parts; i < parts + 8; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => undefined);
  }
}

async function secureGet(key: string): Promise<string | null> {
  const nRaw = await SecureStore.getItemAsync(`${key}__n`);
  if (!nRaw) {
    // Migration: single-key or AsyncStorage fallback
    const single = await SecureStore.getItemAsync(key);
    if (single != null) return single;
    return AsyncStorage.getItem(key);
  }
  const n = Number(nRaw);
  if (!Number.isFinite(n) || n < 1) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part == null) return null;
    out += part;
  }
  return out;
}

async function secureRemove(key: string): Promise<void> {
  const nRaw = await SecureStore.getItemAsync(`${key}__n`);
  const n = nRaw ? Number(nRaw) : 0;
  await SecureStore.deleteItemAsync(`${key}__n`).catch(() => undefined);
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
  const limit = Number.isFinite(n) && n > 0 ? n + 4 : 12;
  for (let i = 0; i < limit; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => undefined);
  }
  await AsyncStorage.removeItem(key).catch(() => undefined);
}

export const authStorage: SupportedStorage =
  Platform.OS === 'web'
    ? AsyncStorage
    : {
        getItem: (key) => secureGet(key),
        setItem: (key, value) => secureSet(key, value),
        removeItem: (key) => secureRemove(key),
      };
