/** Live wall engagement — detection helpers and settings. */

export const POINT_MILESTONES = [50, 100, 250, 500, 1000] as const;
export const MIN_HERO_INTERVAL_MS = 12_000;
export const LIKE_HEART_COOLDOWN_MS = 900;
export const RANK_HIGHLIGHT_MS = 4_500;
export const COMMENT_SPOTLIGHT_INTERVAL_MS = 180_000;
export const PHOTO_OF_HOUR_MS = 60 * 60 * 1000;

export type WallHeroKind =
  | 'new_leader'
  | 'milestone'
  | 'first_photo'
  | 'comment_spotlight'
  | 'photo_of_hour';

export interface WallHeroEvent {
  id: string;
  kind: WallHeroKind;
  title: string;
  subtitle?: string;
  userId?: string;
  durationMs: number;
  confetti?: boolean;
}

export interface WallHeartBurst {
  id: string;
}

export interface LeaderboardRow {
  user_id: string;
  points: number;
  users?: { full_name?: string | null } | null;
}

export interface WallPostRow {
  id: string;
  likes_count?: number | null;
  comments_count?: number | null;
  created_at: string;
  user?: { full_name?: string | null } | null;
}

export interface WallCommentRow {
  id: string;
  content: string;
  created_at: string;
  user?: { full_name?: string | null } | null;
}

export interface WallEngagementSettings {
  effectsEnabled: boolean;
  soundEnabled: boolean;
}

const STORAGE_SOUND = 'collectivelive-wall-sound';

export function parseEngagementSettings(searchParams: { get(name: string): string | null }): WallEngagementSettings {
  const effectsParam = searchParams.get('effects');
  const soundParam = searchParams.get('sound');
  let soundEnabled = false;
  if (soundParam === '1' || soundParam === 'true') soundEnabled = true;
  else if (soundParam === '0' || soundParam === 'false') soundEnabled = false;
  else if (typeof window !== 'undefined') {
    try {
      soundEnabled = localStorage.getItem(STORAGE_SOUND) === '1';
    } catch {
      soundEnabled = false;
    }
  }
  return {
    effectsEnabled: effectsParam !== '0' && effectsParam !== 'false',
    soundEnabled,
  };
}

export function persistSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_SOUND, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function detectNewLeader(
  prev: LeaderboardRow[],
  next: LeaderboardRow[],
): { userId: string; name: string } | null {
  const prevLeader = prev[0]?.user_id;
  const nextLeader = next[0]?.user_id;
  if (!nextLeader || prev.length === 0) return null;
  if (prevLeader === nextLeader) return null;
  const name = next[0]?.users?.full_name?.trim() || 'Someone';
  return { userId: nextLeader, name };
}

export function detectRankUps(
  prev: LeaderboardRow[],
  next: LeaderboardRow[],
): { userId: string; name: string; newRank: number }[] {
  const prevRank = new Map(prev.map((r, i) => [r.user_id, i + 1]));
  const ups: { userId: string; name: string; newRank: number }[] = [];
  next.forEach((r, i) => {
    const newRank = i + 1;
    const oldRank = prevRank.get(r.user_id);
    if (oldRank != null && newRank < oldRank) {
      ups.push({
        userId: r.user_id,
        name: r.users?.full_name?.trim() || 'Someone',
        newRank,
      });
    }
  });
  return ups;
}

export function detectMilestones(
  prev: LeaderboardRow[],
  next: LeaderboardRow[],
  alreadyFired: Set<string>,
): { userId: string; name: string; points: number; milestone: number }[] {
  const prevPoints = new Map(prev.map((r) => [r.user_id, r.points ?? 0]));
  const hits: { userId: string; name: string; points: number; milestone: number }[] = [];
  for (const row of next) {
    const before = prevPoints.get(row.user_id) ?? 0;
    const after = row.points ?? 0;
    if (after <= before) continue;
    for (const m of POINT_MILESTONES) {
      const key = `${row.user_id}:${m}`;
      if (before < m && after >= m && !alreadyFired.has(key)) {
        hits.push({
          userId: row.user_id,
          name: row.users?.full_name?.trim() || 'Someone',
          points: after,
          milestone: m,
        });
      }
    }
  }
  return hits;
}

export function detectFirstPhoto(
  prevCount: number,
  nextCount: number,
  firstPost: WallPostRow | null,
): { postId: string; name: string } | null {
  if (prevCount > 0 || nextCount !== 1 || !firstPost) return null;
  return {
    postId: firstPost.id,
    name: firstPost.user?.full_name?.trim() || 'Someone',
  };
}

export interface PhotoOfHourResult {
  postId: string;
  likes: number;
  name: string;
}

/** Most likes among posts from the last 60 minutes (tie → newest post). Needs ≥1 like. */
export function computePhotoOfHour(posts: WallPostRow[], now: Date = new Date()): string | null {
  return computePhotoOfHourDetailed(posts, now)?.postId ?? null;
}

export function computePhotoOfHourDetailed(
  posts: WallPostRow[],
  now: Date = new Date(),
): PhotoOfHourResult | null {
  const cutoff = now.getTime() - PHOTO_OF_HOUR_MS;
  let best: WallPostRow | null = null;
  let bestLikes = -1;
  let bestTime = 0;
  for (const p of posts) {
    const t = new Date(p.created_at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    const likes = p.likes_count ?? 0;
    if (likes > bestLikes || (likes === bestLikes && t > bestTime)) {
      bestLikes = likes;
      bestTime = t;
      best = p;
    }
  }
  if (!best || bestLikes < 1) return null;
  return {
    postId: best.id,
    likes: bestLikes,
    name: best.user?.full_name?.trim() || 'Someone',
  };
}

export function pickCommentForSpotlight(
  comments: WallCommentRow[],
  now: Date = new Date(),
): WallCommentRow | null {
  const cutoff = now.getTime() - 30 * 60 * 1000;
  const candidates = comments.filter((c) => {
    const t = new Date(c.created_at).getTime();
    if (Number.isNaN(t) || t < cutoff) return false;
    const text = (c.content ?? '').trim();
    return text.length >= 8 && text.length <= 140;
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * Math.min(5, candidates.length))] ?? null;
}

export function milestoneKey(userId: string, milestone: number): string {
  return `${userId}:${milestone}`;
}
