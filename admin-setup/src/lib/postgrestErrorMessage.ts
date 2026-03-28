/**
 * Supabase/PostgREST often returns plain error objects (not `instanceof Error`),
 * so `catch (e) => e.message` becomes undefined and UIs show a generic "Save failed".
 */
export function postgrestErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const msg = typeof o.message === 'string' ? o.message : '';
    const details = typeof o.details === 'string' ? o.details : '';
    const hint = typeof o.hint === 'string' ? o.hint : '';
    const code = typeof o.code === 'string' ? o.code : '';
    const parts = [msg, details, hint, code ? `[${code}]` : ''].filter(Boolean);
    if (parts.length) return parts.join(' — ');
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
