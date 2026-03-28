import * as Linking from 'expo-linking';
import Constants from 'expo-constants';

/**
 * HTTPS page (deployed with admin-setup) forwards tokens → collectivelive://reset-password
 * so email clients open a real URL (no localhost). Set EXPO_PUBLIC_PASSWORD_RESET_WEB_URL in .env.
 *
 * Must be listed in Supabase → Authentication → URL Configuration → Redirect URLs.
 *
 * @see docs/PASSWORD-RESET-SUPABASE.md
 */
export function getPasswordResetRedirectUrl(): string {
  const extra = (Constants.expoConfig as { extra?: { PASSWORD_RESET_WEB_URL?: string } } | null)?.extra;
  const fromExtra = (extra?.PASSWORD_RESET_WEB_URL ?? '').trim().replace(/\/+$/, '');
  const fromEnv = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_PASSWORD_RESET_WEB_URL
    ? String(process.env.EXPO_PUBLIC_PASSWORD_RESET_WEB_URL).trim().replace(/\/+$/, '')
    : '');
  const web = fromExtra || fromEnv;
  if (web && /^https?:\/\//i.test(web)) {
    return web;
  }
  // Dev / fallback: custom scheme (add exact URL to Supabase Redirect URLs)
  return Linking.createURL('reset-password');
}

/** Static scheme URL — add to Supabase Redirect URLs if createURL differs in your build. */
export const PASSWORD_RESET_REDIRECT_FALLBACK = 'collectivelive://reset-password';
