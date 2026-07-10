/** Persist featured-post rotation across wall reloads (same event, multiple takedowns). */

function storageKey(eventId: string): string {
  return `collectivelive-wall-last-featured-${eventId}`;
}

/**
 * Pick which post to feature when the wall opens.
 * Advances one step from the last featured post saved in localStorage.
 */
export function pickStartupFeaturedIndex(posts: { id: string }[], eventId: string): number {
  if (posts.length <= 1) return 0;
  try {
    const lastId = localStorage.getItem(storageKey(eventId));
    if (!lastId) {
      return Math.floor(Math.random() * posts.length);
    }
    const lastIdx = posts.findIndex((p) => p.id === lastId);
    if (lastIdx < 0) {
      return Math.floor(Math.random() * posts.length);
    }
    return (lastIdx + 1) % posts.length;
  } catch {
    return Math.floor(Math.random() * posts.length);
  }
}

export function rememberFeaturedPost(eventId: string, postId: string | null | undefined): void {
  if (!eventId || !postId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(eventId), postId);
  } catch {
    /* private browsing / quota */
  }
}
