/** Full URL from email (includes #access_token=…) — path-only routing drops the hash. */
let pending: string | null = null;

export function setPendingPasswordRecoveryUrl(url: string): void {
  pending = url;
}

export function consumePendingPasswordRecoveryUrl(): string | null {
  const u = pending;
  pending = null;
  return u;
}
