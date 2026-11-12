/** Featured-post rotation: every photo once before any repeats.
 *  Exception: photo of the hour may appear twice per pass (one bonus).
 *  Progress is stored in localStorage so open/close continues the pass.
 */

function passKey(eventId: string): string {
  return `collectivelive-wall-pass-${eventId}`;
}

export interface WallPassState {
  /** Post ids already shown in the current pass. */
  shownIds: string[];
  /** Last featured post id (resume point on reopen). */
  lastId: string | null;
  /** True after the one allowed extra photo-of-the-hour appearance this pass. */
  pohBonusUsed: boolean;
}

export function loadPassState(eventId: string): WallPassState {
  if (!eventId || typeof window === 'undefined') {
    return { shownIds: [], lastId: null, pohBonusUsed: false };
  }
  try {
    const raw = localStorage.getItem(passKey(eventId));
    if (!raw) return { shownIds: [], lastId: null, pohBonusUsed: false };
    const parsed = JSON.parse(raw) as Partial<WallPassState>;
    return {
      shownIds: Array.isArray(parsed.shownIds)
        ? parsed.shownIds.filter((id): id is string => typeof id === 'string')
        : [],
      lastId: typeof parsed.lastId === 'string' ? parsed.lastId : null,
      pohBonusUsed: parsed.pohBonusUsed === true,
    };
  } catch {
    return { shownIds: [], lastId: null, pohBonusUsed: false };
  }
}

export function savePassState(eventId: string, state: WallPassState): void {
  if (!eventId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      passKey(eventId),
      JSON.stringify({
        shownIds: state.shownIds,
        lastId: state.lastId,
        pohBonusUsed: state.pohBonusUsed,
      }),
    );
  } catch {
    /* private browsing / quota */
  }
}

function pruneShownIds(shownIds: string[], posts: { id: string }[]): string[] {
  const existing = new Set(posts.map((p) => p.id));
  return shownIds.filter((id) => existing.has(id));
}

/**
 * Next index that has not been shown this pass.
 * Never returns an already-shown photo until every current photo has been shown.
 */
export function pickNextUnshownIndex(
  posts: { id: string }[],
  shownIds: string[],
  fromIndex: number,
): { index: number; shownIds: string[]; passReset: boolean } {
  const n = posts.length;
  if (n <= 0) return { index: 0, shownIds: [], passReset: false };
  if (n === 1) return { index: 0, shownIds: [posts[0].id], passReset: false };

  let shown = pruneShownIds(shownIds, posts);
  let passReset = false;
  if (shown.length >= n) {
    shown = [];
    passReset = true;
  }

  const start = ((fromIndex % n) + n) % n;
  for (let step = 1; step <= n; step++) {
    const i = (start + step) % n;
    if (!shown.includes(posts[i].id)) {
      return { index: i, shownIds: shown, passReset };
    }
  }

  return { index: (start + 1) % n, shownIds: [], passReset: true };
}

/**
 * Next featured index.
 * - All photos: once before any of them repeat
 * - Photo of the hour only: one bonus appearance (twice max) after its normal turn,
 *   once roughly half the pass is done
 */
export function pickNextFeaturedIndex(params: {
  posts: { id: string }[];
  shownIds: string[];
  fromIndex: number;
  photoOfHourPostId: string | null;
  pohBonusUsed: boolean;
}): { index: number; shownIds: string[]; pohBonusUsed: boolean } {
  const { posts, shownIds, fromIndex, photoOfHourPostId, pohBonusUsed } = params;
  const n = posts.length;
  const shown = pruneShownIds(shownIds, posts);

  // Only POH may repeat once — and only after it already had its normal turn
  if (
    n > 2 &&
    !pohBonusUsed &&
    photoOfHourPostId &&
    shown.includes(photoOfHourPostId) &&
    shown.length >= Math.max(2, Math.floor(n / 2))
  ) {
    const pohIdx = posts.findIndex((p) => p.id === photoOfHourPostId);
    // Don't insert bonus if there are still unshown photos and we'd skip...
    // Actually we INSERT between unshown picks — unshown photos still get their turn after.
    if (pohIdx >= 0 && pohIdx !== fromIndex) {
      return {
        index: pohIdx,
        shownIds: shown,
        pohBonusUsed: true,
      };
    }
  }

  const next = pickNextUnshownIndex(posts, shown, fromIndex);
  return {
    index: next.index,
    shownIds: next.shownIds,
    pohBonusUsed: next.passReset ? false : pohBonusUsed,
  };
}

/**
 * Prefer a brand-new upload if it has not been shown this pass.
 * Never forces a repeat of a non-POH photo.
 */
export function pickPreferredOrNextUnshown(
  posts: { id: string }[],
  shownIds: string[],
  fromIndex: number,
  preferredPostId: string | null,
  pohBonusUsed: boolean,
): { index: number; shownIds: string[]; pohBonusUsed: boolean } {
  const shown = pruneShownIds(shownIds, posts);
  if (preferredPostId && !shown.includes(preferredPostId)) {
    const idx = posts.findIndex((p) => p.id === preferredPostId);
    if (idx >= 0) return { index: idx, shownIds: shown, pohBonusUsed };
  }
  return pickNextFeaturedIndex({
    posts,
    shownIds: shown,
    fromIndex,
    photoOfHourPostId: null,
    pohBonusUsed,
  });
}

/**
 * Startup / reopen: resume pass; never re-show already-shown photos
 * (except POH bonus handled during rotation).
 */
export function pickStartupFeaturedIndex(
  posts: { id: string }[],
  photoOfHourPostId: string | null,
  pass: WallPassState,
): { index: number; shownIds: string[]; pohBonusUsed: boolean } {
  const n = posts.length;
  if (n <= 1) return { index: 0, shownIds: [], pohBonusUsed: false };

  let shown = pruneShownIds(pass.shownIds, posts);
  let pohBonusUsed = pass.pohBonusUsed;
  if (shown.length >= n) {
    shown = [];
    pohBonusUsed = false;
  }

  const lastIdx = pass.lastId ? posts.findIndex((p) => p.id === pass.lastId) : -1;

  if (lastIdx >= 0) {
    if (pass.lastId && !shown.includes(pass.lastId)) {
      shown = [...shown, pass.lastId];
      if (shown.length >= n) {
        shown = [];
        pohBonusUsed = false;
      }
    }
    const next = pickNextFeaturedIndex({
      posts,
      shownIds: shown,
      fromIndex: lastIdx,
      photoOfHourPostId,
      pohBonusUsed,
    });
    return {
      index: next.index,
      shownIds: next.shownIds,
      pohBonusUsed: next.pohBonusUsed,
    };
  }

  if (photoOfHourPostId && !shown.includes(photoOfHourPostId)) {
    const pohIdx = posts.findIndex((p) => p.id === photoOfHourPostId);
    if (pohIdx >= 0) return { index: pohIdx, shownIds: shown, pohBonusUsed };
  }

  for (let i = 0; i < n; i++) {
    if (!shown.includes(posts[i].id)) {
      return { index: i, shownIds: shown, pohBonusUsed };
    }
  }
  return { index: 0, shownIds: [], pohBonusUsed: false };
}

export function markPostShown(shownIds: string[], postId: string): string[] {
  if (!postId) return shownIds;
  if (shownIds.includes(postId)) return shownIds;
  return [...shownIds, postId];
}

export function rememberFeaturedPost(
  eventId: string,
  postId: string | null | undefined,
  shownIds: string[],
  pohBonusUsed: boolean,
): void {
  if (!eventId || !postId) return;
  savePassState(eventId, { shownIds, lastId: postId, pohBonusUsed });
}
