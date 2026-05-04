/** Full URL from email (includes #access_token=…) — path-only routing drops the hash. */
let pending: string | null = null;

export function setPendingPasswordRecoveryUrl(url: string): void {
  pending = url;
}

/** Non-destructive read (e.g. navigate once navigation tree is ready). */
export function peekPendingPasswordRecoveryUrl(): string | null {
  return pending;
}

export function consumePendingPasswordRecoveryUrl(): string | null {
  const u = pending;
  pending = null;
  return u;
}
