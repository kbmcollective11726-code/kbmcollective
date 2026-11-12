import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

const DEFAULT_LAUNCH_WAIT_MS = 25_000;

export function isOtaUpdatesEnabled(): boolean {
  if (__DEV__) return false;
  if (Constants.appOwnership === 'expo') return false;
  try {
    return Updates.isEnabled;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ota_timeout')), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Cold start: download an update and apply it immediately when safe.
 * Skipped by the caller when a badge/password deep link is pending.
 */
export async function syncAppUpdateOnLaunch(options?: {
  maxWaitMs?: number;
}): Promise<'reloaded' | 'upToDate' | 'skipped' | 'failed'> {
  if (!isOtaUpdatesEnabled()) return 'skipped';

  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_LAUNCH_WAIT_MS;

  try {
    const checkResult = await withTimeout(Updates.checkForUpdateAsync(), maxWaitMs);
    if (!checkResult.isAvailable) return 'upToDate';

    await withTimeout(Updates.fetchUpdateAsync(), maxWaitMs);
    // Apply now so event-day fixes are not stuck behind a second cold start.
    await Updates.reloadAsync();
    return 'reloaded';
  } catch {
    return 'failed';
  }
}

/**
 * Foreground: download and apply an update immediately.
 * Event-day fixes (R2 upload, profile) were stuck when we only prefetched
 * for the next cold start while checkAutomatically is NEVER.
 */
export async function prefetchAppUpdateOnResume(): Promise<void> {
  if (!isOtaUpdatesEnabled()) return;

  try {
    const checkResult = await Updates.checkForUpdateAsync();
    if (!checkResult.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // Non-blocking; launch sync will retry.
  }
}
