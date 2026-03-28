import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

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

// Per-request timeout so connections that hang after app resume abort and can retry (test at 2s often succeeds).
const FETCH_ABORT_MS = 15000;
/** GoTrue (`/auth/v1/`) can be slower than REST; 15s cuts off password updates / token refresh on some networks. */
const AUTH_FETCH_ABORT_MS = 90000;

let globalController = new AbortController();

export function abortAllRequests(): void {
  globalController.abort();
  globalController = new AbortController();
}

// Custom fetch: if server returns non-JSON (e.g. error page), return a JSON error so we don't get "JSON Parse error".
// PostgREST returns 204 No Content with empty body for UPDATE/DELETE without .select() — treat that as valid.
// We no longer sign out on 401 in the global fetch — that caused one failing request (e.g. Notifications)
// to sign the user out and break all other pages. withRetryAndRefresh handles refresh+retry per request.

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
    const res = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    const text = await res.text();

  if (res.status === 204 || text.trim() === '') {
    return new Response('{}', {
      status: res.status,
      statusText: res.statusText,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    JSON.parse(text);
  } catch {
    const errBody = JSON.stringify({
      error: 'invalid_response',
      error_description: 'Server returned invalid response. Restart Expo with "npx expo start --clear" and use Wi-Fi.',
    });
    return new Response(errBody, { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (e) {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.toLowerCase().includes('timeout')) {
      throw new Error('Request timed out');
    }
    throw e;
  } finally {
    globalSignal.removeEventListener('abort', onGlobalAbort);
  }
};

// autoRefreshToken and persistSession ensure session stays valid after app background/foreground.
export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: safeFetch,
  },
});

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
  isRefreshing = false;
  refreshQueue = [];
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

// Longer timeouts so requests succeed after app resume (slow network reconnection). We retry once on failure.
const REQUEST_TIMEOUT_MS = 15000;
const REFRESH_TIMEOUT_MS = 8000;

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
  return new Promise((resolve) => refreshQueue.push(resolve));
}

function resolveRefreshQueue(): void {
  isRefreshing = false;
  const queue = refreshQueue.splice(0);
  queue.forEach((resolve) => resolve());
}

export async function withRetryAndRefresh<T>(fn: () => Promise<T>): Promise<T> {
  await waitForRefresh();
  try {
    return await withRequestTimeout(fn());
  } catch (firstErr) {
    if (__DEV__) console.warn('[Supabase] First request failed, refreshing session…', getErrorMessage(firstErr));
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        await withRequestTimeout(refreshSessionIfNeeded(), REFRESH_TIMEOUT_MS);
        if (__DEV__) console.log('[Supabase] Session refreshed');
      } catch (_) {
        if (__DEV__) console.warn('[Supabase] Session refresh failed');
      } finally {
        resolveRefreshQueue();
      }
    } else {
      await waitForRefresh();
    }
    try {
      return await withRequestTimeout(fn());
    } catch (secondErr) {
      await delay(1000);
      try {
        return await withRequestTimeout(fn());
      } catch (finalErr) {
        const msg = getErrorMessage(finalErr);
        if (__DEV__) console.warn('[Supabase] All retries failed:', msg);
        throw new Error(msg || 'Error - page not loading');
      }
    }
  }
}

/** Same as supabase but uses default fetch. Use for Android Storage uploads so custom fetch cannot break the request. */
export const supabaseStorage = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
