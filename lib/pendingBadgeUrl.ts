import AsyncStorage from '@react-native-async-storage/async-storage';

/** Badge token from collectivelive://badge?t=… when navigation was not ready yet (cold start). */
const STORAGE_KEY = '@kbm/pending_badge_token';

let pendingToken: string | null = null;
let hydratePromise: Promise<string | null> | null = null;

export function setPendingBadgeToken(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) return;
  pendingToken = trimmed;
  void AsyncStorage.setItem(STORAGE_KEY, trimmed).catch(() => {});
}

export function peekPendingBadgeToken(): string | null {
  return pendingToken;
}

export function consumePendingBadgeToken(): string | null {
  const t = pendingToken;
  pendingToken = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  return t;
}

/** Load any persisted token (survives OTA reload). Safe to call multiple times. */
export function hydratePendingBadgeToken(): Promise<string | null> {
  if (pendingToken) return Promise.resolve(pendingToken);
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const trimmed = stored?.trim() || null;
      if (trimmed) pendingToken = trimmed;
      return pendingToken;
    } catch {
      return pendingToken;
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}
