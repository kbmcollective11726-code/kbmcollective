/** Shared helpers for classifying request failures (kept free of supabase client imports). */

export function getErrorMessageLite(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err ?? '');
}

export function isTransientRequestFailure(err: unknown): boolean {
  const message = getErrorMessageLite(err).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('aborted') ||
    message.includes('econnreset') ||
    message.includes('enotfound')
  );
}

export function looksLikeConnectivityOutage(err?: unknown): boolean {
  if (err == null) return true;
  if (isTransientRequestFailure(err)) return true;
  const msg = getErrorMessageLite(err).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('cloudflare') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway')
  );
}
