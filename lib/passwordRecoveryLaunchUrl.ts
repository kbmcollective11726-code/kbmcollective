/**
 * True if this URL is our password-recovery handoff from auth-recovery.html
 * (collectivelive://…) or carries Supabase recovery tokens / PKCE code.
 */
export function isPasswordRecoveryLaunchUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('reset-password')) return true;
  if (url.includes('access_token=')) return true;
  if (url.includes('type=recovery')) return true;
  // PKCE; avoid matching ?error_code= as code=
  if (/(?:^|[?&#])code=/.test(url)) return true;
  return false;
}
