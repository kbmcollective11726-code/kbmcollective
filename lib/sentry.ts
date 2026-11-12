import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

type Extra = {
  SENTRY_DSN?: string;
};

function readExtraDsn(): string {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as Extra;
  if (expoExtra.SENTRY_DSN?.trim()) return expoExtra.SENTRY_DSN.trim();

  // Expo Go / legacy manifest shapes
  const manifestExtra = (Constants.manifest as { extra?: Extra } | null)?.extra;
  if (manifestExtra?.SENTRY_DSN?.trim()) return manifestExtra.SENTRY_DSN.trim();

  const manifest2 = Constants.manifest2 as
    | { extra?: { expoClient?: { extra?: Extra } } }
    | null
    | undefined;
  const fromManifest2 = manifest2?.extra?.expoClient?.extra?.SENTRY_DSN?.trim();
  if (fromManifest2) return fromManifest2;

  return '';
}

function resolveDsn(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_SENTRY_DSN || '').trim();
  if (fromEnv) return fromEnv;
  return readExtraDsn();
}

let cachedDsn: string | null = null;
let initialized = false;

function getDsn(): string {
  if (cachedDsn === null) cachedDsn = resolveDsn();
  return cachedDsn;
}

/** Call once at app startup. No-ops if DSN is missing so local/dev still works. */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = getDsn();
  if (!dsn) {
    if (__DEV__) {
      console.log('[Sentry] Skipped — set EXPO_PUBLIC_SENTRY_DSN in .env (see .env.example)');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    enableAutoSessionTracking: true,
    // Errors/crashes only — keep free quota and avoid perf overhead for now
    tracesSampleRate: 0,
    sendDefaultPii: false,
    enabled: true,
  });

  if (__DEV__) {
    console.log('[Sentry] Enabled');
  }
}

export function setSentryUser(
  user: { id: string; email?: string | null } | null
): void {
  if (!getDsn()) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  // Keep Sentry correlation pseudonymous; do not send email addresses.
  Sentry.setUser({
    id: user.id,
  });
}

export function captureAppException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!getDsn()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function isSentryEnabled(): boolean {
  return Boolean(getDsn());
}

export { Sentry };
