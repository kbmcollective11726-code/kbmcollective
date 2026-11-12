/** Validate project anon credentials for browser/native Edge callers. */

export function projectRefFromSupabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Accept the runtime SUPABASE_ANON_KEY (legacy JWT or sb_publishable_)
 * or a legacy anon JWT for this project ref.
 *
 * Anon credentials are already public in clients. This rejects empty/random
 * tokens and other projects. Success-path writes still require auth.getUser().
 */
export function isProjectAnonCredential(
  presented: string,
  envAnonKey: string,
  projectRef: string | null,
): boolean {
  const token = presented.trim();
  if (!token) return false;
  if (envAnonKey && token === envAnonKey) return true;
  if (token.startsWith("sb_")) return false;
  if (!token.startsWith("eyJ") || !projectRef) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: string; ref?: string };
    return payload.role === "anon" && payload.ref === projectRef;
  } catch {
    return false;
  }
}

export function presentedAnonKey(req: Request): string {
  const apikey = req.headers.get("apikey")?.trim() ?? "";
  if (apikey) return apikey;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return "";
}
