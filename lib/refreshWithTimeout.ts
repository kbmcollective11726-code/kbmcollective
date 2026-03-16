/**
 * Race a promise against a timeout so refresh never hangs forever.
 * 45s allows slow networks / Expo Go / tunnel to complete without false timeouts.
 */
const REFRESH_TIMEOUT_MS = 45000;

export function withRefreshTimeout<T>(promise: Promise<T>, ms: number = REFRESH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ]);
}
