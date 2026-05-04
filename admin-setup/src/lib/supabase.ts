import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string)?.trim()?.replace(/\/+$/, '') || '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() || '';

export const isConfigured = !!url && !!anonKey && !url.includes('placeholder');
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

/** Headers for direct `fetch` to `/functions/v1/*` (matches what the Supabase client sends). */
export function edgeFunctionHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  };
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true },
});
