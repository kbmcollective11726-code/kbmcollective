/**
 * When the app comes back from background, the root layout refreshes the session
 * then calls notifyAfterSessionRefreshed(). Screens register their refetch here so
 * they run after the refresh attempt completes. We also set lastNotifiedAt so
 * screens that mount/focus later (e.g. after tabs finish loading) can refetch if
 * session was just refreshed.
 */

const refetchCallbacks = new Set<() => void>();
let lastNotifiedAt = 0;

export function registerRefetchOnSessionRefreshed(fn: () => void): () => void {
  refetchCallbacks.add(fn);
  return () => refetchCallbacks.delete(fn);
}

export function getLastSessionRefreshedAt(): number {
  return lastNotifiedAt;
}

/** Call from useFocusEffect: if session was refreshed in the last 15s, run refetch (handles late-mounted screens). */
export function shouldRefetchAfterResume(): boolean {
  if (lastNotifiedAt <= 0) return false;
  return Date.now() - lastNotifiedAt < 15000;
}

export function notifyAfterSessionRefreshed(): void {
  lastNotifiedAt = Date.now();
  refetchCallbacks.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      if (__DEV__) console.warn('Refetch after session refresh failed:', e);
    }
  });
}
