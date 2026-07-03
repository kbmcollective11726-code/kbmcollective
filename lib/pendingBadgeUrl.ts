/** Badge token from collectivelive://badge?t=… when navigation was not ready yet (cold start). */
let pendingToken: string | null = null;

export function setPendingBadgeToken(token: string): void {
  pendingToken = token.trim();
}

export function peekPendingBadgeToken(): string | null {
  return pendingToken;
}

export function consumePendingBadgeToken(): string | null {
  const t = pendingToken;
  pendingToken = null;
  return t;
}
