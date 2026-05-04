import { supabase } from './supabase';

/**
 * Refreshes the access token when it is missing or close to expiry so REST and Edge Function calls
 * don't return 401 after the tab has been open for a long time.
 */
export async function refreshSupabaseSessionIfNeeded(): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.refresh_token) return;
    const exp = session.expires_at;
    const msLeft = exp ? exp * 1000 - Date.now() : 0;
    if (!exp || msLeft < 5 * 60_000) {
      await supabase.auth.refreshSession();
    }
  } catch {
    // ignore; caller will surface query errors
  }
}
