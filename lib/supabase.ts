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

// Custom fetch: if server returns non-JSON (e.g. error page), return a JSON error so we don't get "JSON Parse error".
// PostgREST returns 204 No Content with empty body for UPDATE/DELETE without .select() — treat that as valid.
// We no longer sign out on 401 in the global fetch — that caused one failing request (e.g. Notifications)
// to sign the user out and break all other pages. withRetryAndRefresh handles refresh+retry per request.

const safeFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
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
};

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
  foregroundRefreshPromise = refreshSessionIfNeeded().then(() => {}, () => {});
}

const FOREGROUND_REFRESH_TIMEOUT_MS = 5000;

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

// Keep timeouts short so users see success or error quickly (20s). We retry once on failure.
const REQUEST_TIMEOUT_MS = 20000;
const REFRESH_TIMEOUT_MS = 10000;

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

/**
 * Run a fetch with retry after session refresh so pages load after app was in background.
 * Preserves the last real error so the UI can show it (no more generic "page not loading" only).
 */
export async function withRetryAndRefresh<T>(fn: () => Promise<T>): Promise<T> {
  // #region agent log
  fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'lib/supabase.ts:withRetryAndRefresh',message:'entry',data:{},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  let lastError: unknown = null;
  const run = async (): Promise<T> => {
    try {
      return await withRequestTimeout(fn());
    } catch (e) {
      lastError = e;
      throw e;
    }
  };
  try {
    const result = await run();
    // #region agent log
    fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'lib/supabase.ts:withRetryAndRefresh',message:'first run ok',data:{},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    return result;
  } catch (firstErr) {
    // #region agent log
    fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'lib/supabase.ts:withRetryAndRefresh',message:'first run threw',data:{msg:String(firstErr).slice(0,120)},timestamp:Date.now(),hypothesisId:'H2,H4'})}).catch(()=>{});
    // #endregion
    try {
      await withRequestTimeout(refreshSessionIfNeeded(), REFRESH_TIMEOUT_MS);
    } catch (_) {}
    try {
      const result = await run();
      // #region agent log
      fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'lib/supabase.ts:withRetryAndRefresh',message:'retry run ok',data:{},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      return result;
    } catch {
      await delay(1500);
      try {
        return await run();
      } catch {
        const msg = getErrorMessage(lastError);
        // #region agent log
        fetch('http://127.0.0.1:7672/ingest/15c61a4e-0b7b-4210-b934-e9b8b6c55b92',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b4bafa'},body:JSON.stringify({sessionId:'b4bafa',location:'lib/supabase.ts:withRetryAndRefresh',message:'all retries failed',data:{msg:msg.slice(0,120)},timestamp:Date.now(),hypothesisId:'H2,H4'})}).catch(()=>{});
        // #endregion
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
