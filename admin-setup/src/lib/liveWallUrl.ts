/** Base URL of the deployed live-wall Next app (no trailing slash), e.g. https://your-wall.vercel.app */
export function getLiveWallBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LIVE_WALL_URL;
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\/+$/, '');
  return t.length > 0 ? t : null;
}

/** Full URL to the wall for one event (`/wall?event=…`), or null if not configured. */
export function liveWallUrlForEvent(eventId: string): string | null {
  const base = getLiveWallBaseUrl();
  if (!base || !eventId) return null;
  return `${base}/wall?event=${encodeURIComponent(eventId)}`;
}
