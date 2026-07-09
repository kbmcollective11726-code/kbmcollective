import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

const DEFAULT_LAUNCH_WAIT_MS = 10_000;

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

/** Cold start: check EAS Update, download, and reload before app UI mounts. */
export async function syncAppUpdateOnLaunch(options?: {
  maxWaitMs?: number;
}): Promise<'reloaded' | 'upToDate' | 'skipped' | 'failed'> {
  if (!isOtaUpdatesEnabled()) return 'skipped';

  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_LAUNCH_WAIT_MS;

  try {
    const checkResult = await withTimeout(Updates.checkForUpdateAsync(), maxWaitMs);
    if (!checkResult.isAvailable) return 'upToDate';

    await withTimeout(Updates.fetchUpdateAsync(), maxWaitMs);
    await Updates.reloadAsync();
    return 'reloaded';
  } catch {
    return 'failed';
  }
}

/** Foreground: prefetch an update for the next cold start (no mid-session reload). */
export async function prefetchAppUpdateOnResume(): Promise<void> {
  if (!isOtaUpdatesEnabled()) return;

  try {
    const checkResult = await Updates.checkForUpdateAsync();
    if (!checkResult.isAvailable) return;
    await Updates.fetchUpdateAsync();
  } catch {
    // Non-blocking; launch sync will retry.
  }
}
