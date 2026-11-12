import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { authStorage } from './authStorage';
import { isTransientRequestFailure as isTransientFailureShared } from './requestFailure';

// Expo Go: read from Constants.expoConfig.extra (set by app.config.js). Else process.env (builds).
const extra = (Constants.expoConfig as { extra?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string } } | null)?.extra;
const fromEnv = (extra?.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_URL = fromEnv;
const SUPABASE_ANON_KEY = (extra?.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

// Use placeholders if missing so the app loads in Expo Go; auth will fail until .env is set.
const url = SUPABASE_URL || 'https://placeholder.supabase.co';
const key = SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured = !url.includes('placeholder');
/** Base URL for the Supabase project (e.g. for calling Edge Functions with fetch). */
export const supabaseUrl = url;
export const supabaseAnonKey = key;

/** Test if the device can reach Supabase (for Debug panel). Uses 10s timeout. */
export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  if (!url || url.includes('placeholder')) {
    return { ok: false, message: 'Supabase URL not set. Check .env and run: npx expo start --clear' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      signal: controller.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    clearTimeout(timeout);
    return { ok: true, message: `Reachable (${res.status}). If requests still time out, try: npx expo start --tunnel` };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.toLowerCase().includes('timeout')) {
      return { ok: false, message: 'Not reachable (10s timeout). Use same Wi‑Fi as PC or run: npx expo start --tunnel' };
    }
    return { ok: false, message: `Error: ${msg.slice(0, 100)}` };
  }
}

const FETCH_ABORT_MS = Platform.OS === 'android' ? 22_000 : 15_000;
/** GoTrue (`/auth/v1/`) can be slower than REST; 15s cuts off password updates / token refresh on some networks. */
const AUTH_FETCH_ABORT_MS = 90000;

let globalController = new AbortController();

export function abortAllRequests(): void {
  globalController.abort();
  globalController = new AbortController();
}

// Custom fetch: abort hung requests. Do NOT buffer/parse the body here — reading
// res.text() has stalled on Android OkHttp in Expo and left pages on "Loading…".
// We no longer sign out on 401 in the global fetch — that caused one failing request
// (e.g. Notifications) to sign the user out and break all other pages.
// withRetryAndRefresh handles refresh+retry per request.

function requestUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

const safeFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const globalSignal = globalController.signal;
  const onGlobalAbort = () => controller.abort();
  globalSignal.addEventListener('abort', onGlobalAbort);
  const urlStr = requestUrlString(input);
  const isAuth = urlStr.includes('/auth/v1/');
  const abortMs = isAuth ? AUTH_FETCH_ABORT_MS : FETCH_ABORT_MS;
  const timeoutId = setTimeout(() => controller.abort(), abortMs);
  const signal = init?.signal;
  const onAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', onAbort);
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.toLowerCase().includes('timeout')) {
      throw new Error('Request timed out');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    globalSignal.removeEventListener('abort', onGlobalAbort);
  }
};

// autoRefreshToken and persistSession ensure session stays valid after app background/foreground.
export const supabase = createClient(url, key, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: safeFetch,
    // Both Android (OkHttp) and iOS (CFNetwork) occasionally receive the
    // response headers but stall while decoding compressed PostgREST bodies in
    // Expo Go. Empty/HEAD responses are unaffected. Requesting an uncompressed
    // body keeps standard fetch while avoiding that decoder path.
    headers: {
      'Accept-Encoding': 'identity',
    },
  },
});

// Keep one GoTrue instance responsible for persisted sessions and token
// refreshes. Multiple clients sharing the same auth storage key can contend for
// the auth lock in Expo Go and prevent otherwise healthy REST requests starting.
export const supabaseAuthNative = supabase;

const AUTH_USER_MS = 70_000;

/**
 * Password + metadata update via GoTrue REST, using global fetch (not safeFetch).
 * Fixes devices where supabase.auth.updateUser() never completes behind the custom fetch wrapper.
 * @see https://supabase.com/docs/reference/javascript/auth-updateuser
 */
export async function updateAuthUserPasswordWithNativeFetch(
  accessToken: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!accessToken || url.includes('placeholder')) {
    return { ok: false, message: 'Not signed in or Supabase URL missing.' };
  }
  const base = url.replace(/\/+$/, '');
  const endpoint = `${base}/auth/v1/user`;
  const payload = JSON.stringify({
    password: newPassword,
    data: { must_change_password: false },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    apikey: key,
  };

  const run = async (method: 'PUT' | 'PATCH'): Promise<{ ok: boolean; status: number; body: string }> => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), AUTH_USER_MS);
    try {
      const res = await globalThis.fetch(endpoint, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      const body = await res.text();
      clearTimeout(tid);
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      clearTimeout(tid);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('abort') || msg.toLowerCase().includes('aborted')) {
        return { ok: false, status: 0, body: 'Request timed out' };
      }
      return { ok: false, status: 0, body: msg };
    }
  };

  let r = await run('PUT');
  if (r.status === 405) {
    r = await run('PATCH');
  }

  if (!r.ok) {
    let parsed: { error?: string; error_description?: string; msg?: string } = {};
    try {
      parsed = r.body ? JSON.parse(r.body) : {};
    } catch {
      /* use raw body */
    }
    const msg =
      parsed.error_description ||
      parsed.error ||
      parsed.msg ||
      (r.body ? r.body.slice(0, 200) : '') ||
      `Request failed (${r.status || 'network'})`;
    return { ok: false, message: String(msg) };
  }

  return { ok: true };
}

/** Call after a fetch fails to recover from expired token; returns true if session was refreshed. */
export async function refreshSessionIfNeeded(): Promise<boolean> {
  const { data } = await supabase.auth.refreshSession();
  return !!data?.session;
}

/** Returns true if we have a session (current or after one refresh). Use before loading to show "Session expired" instead of generic error. Timeout 10s so we don't hang. */
export async function hasValidSession(): Promise<boolean> {
  const timeout = (ms: number) => new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Session check timeout')), ms));
  try {
    const check = async (): Promise<boolean> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return true;
      const { data } = await supabase.auth.refreshSession();
      return !!data?.session;
    };
    return await Promise.race([check(), timeout(10000)]);
  } catch {
    return false;
  }
}

// When app comes back from background: one shared refresh; whoever gets 'active' first starts it, screens wait then load.
let foregroundRefreshPromise: Promise<void> = Promise.resolve();
let foregroundRefreshStartedAt = 0;
const FOREGROUND_REFRESH_DEBOUNCE_MS = 3000;

/** Call when AppState becomes 'active'. Starts one shared refresh (debounced) so all tabs can wait for it. */
export function startForegroundRefresh(): void {
  const now = Date.now();
  if (now - foregroundRefreshStartedAt < FOREGROUND_REFRESH_DEBOUNCE_MS) return;
  foregroundRefreshStartedAt = now;
  // Always resolve any waiters — clearing the queue without resolve left Android
  // pages stuck on "Loading…" after lock-screen / tab resume at events.
  resolveRefreshQueue();
  foregroundRefreshPromise = refreshSessionIfNeeded().then(() => {}, () => {});
}

// Wait up to 8s for root's refresh so tabs don't all run their own refresh when app resumes.
const FOREGROUND_REFRESH_TIMEOUT_MS = 8000;

/** Wait for the refresh started by startForegroundRefresh(), with a timeout so we never hang. */
export function awaitForegroundRefresh(): Promise<void> {
  return Promise.race([
    foregroundRefreshPromise,
    new Promise<void>((r) => setTimeout(r, FOREGROUND_REFRESH_TIMEOUT_MS)),
  ]);
}

/** Delay helper for retries */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep these aligned with the transport timeout. Auth refreshes have been
// observed taking around 30 seconds while the hosted project wakes up.
// Android venue Wi‑Fi: fail faster so users see Retry instead of endless Loading.
const REQUEST_TIMEOUT_MS = Platform.OS === 'android' ? 25_000 : 60_000;
const REFRESH_TIMEOUT_MS = Platform.OS === 'android' ? 25_000 : 60_000;

function withRequestTimeout<T>(p: Promise<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ]);
}

/** Turn any thrown value into a short message for the UI (Supabase, Error, string, etc.). */
export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err.slice(0, 150);
  const obj = err as { message?: string; code?: string; error_description?: string };
  const msg = obj?.message ?? obj?.error_description;
  if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 150);
  if (obj?.code) return `Error ${obj.code}`;
  return String(err).slice(0, 150);
}

let isRefreshing = false;
let refreshQueue: Array<() => void> = [];

function waitForRefresh(): Promise<void> {
  if (!isRefreshing) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) => {
      refreshQueue.push(resolve);
    }),
    // Never block page loads forever if a refresh waiter was dropped (Android resume).
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ]);
}

function resolveRefreshQueue(): void {
  isRefreshing = false;
  const queue = refreshQueue.splice(0);
  queue.forEach((resolve) => resolve());
}

function isAuthenticationFailure(err: unknown): boolean {
  const value = err as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  } | null;
  const text = `${value?.name ?? ''} ${value?.message ?? ''}`.toLowerCase();
  return (
    value?.status === 401 ||
    value?.code === 'PGRST301' ||
    value?.code === 'PGRST302' ||
    text.includes('jwt expired') ||
    text.includes('invalid jwt') ||
    text.includes('auth session missing') ||
    text.includes('not authenticated')
  );
}

export function isTransientRequestFailure(err: unknown): boolean {
  return isTransientFailureShared(err);
}

export async function withRetryAndRefresh<T>(fn: () => Promise<T>): Promise<T> {
  await waitForRefresh();
  try {
    return await withRequestTimeout(fn());
  } catch (firstErr) {
    const authFailure = isAuthenticationFailure(firstErr);
    const transientFailure = isTransientRequestFailure(firstErr);

    // Query-shape, RLS, validation, and other deterministic database failures
    // cannot be repaired by refreshing the token.
    if (!authFailure && !transientFailure) {
      if (__DEV__) {
        console.log('[Supabase] Non-retryable request failure:', getErrorMessage(firstErr));
      }
      throw firstErr;
    }

    if (authFailure) {
      if (__DEV__) console.log('[Supabase] Authentication failed, refreshing session…');
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          await withRequestTimeout(refreshSessionIfNeeded(), REFRESH_TIMEOUT_MS);
          if (__DEV__) console.log('[Supabase] Session refreshed');
        } catch (refreshErr) {
          if (__DEV__) console.log('[Supabase] Session refresh failed:', getErrorMessage(refreshErr));
        } finally {
          resolveRefreshQueue();
        }
      } else {
        await waitForRefresh();
      }
    } else {
      if (__DEV__) console.log('[Supabase] Transient request failure, retrying once…', getErrorMessage(firstErr));
      await delay(750);
    }

    try {
      return await withRequestTimeout(fn());
    } catch (retryErr) {
      const msg = getErrorMessage(retryErr);
      if (__DEV__) console.warn('[Supabase] Retry failed:', msg);
      throw new Error(msg || 'Error - page not loading');
    }
  }
}

/** Compatibility alias; all operations share one authenticated client. */
export const supabaseStorage = supabase;
