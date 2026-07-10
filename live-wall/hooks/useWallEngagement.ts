'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COMMENT_SPOTLIGHT_INTERVAL_MS,
  MIN_HERO_INTERVAL_MS,
  LIKE_HEART_COOLDOWN_MS,
  RANK_HIGHLIGHT_MS,
  detectFirstPhoto,
  detectMilestones,
  detectNewLeader,
  detectRankUps,
  milestoneKey,
  pickCommentForSpotlight,
  computePhotoOfHourDetailed,
  type WallCommentRow,
  type WallEngagementSettings,
  type WallHeartBurst,
  type WallHeroEvent,
  type WallHeroKind,
  type LeaderboardRow,
  type WallPostRow,
} from '../lib/wallEngagement';
import { playWallSound, type WallSoundKind } from '../lib/wallSound';

interface UseWallEngagementParams {
  settings: WallEngagementSettings;
  posts: WallPostRow[];
  featuredPost: WallPostRow | null;
  leaderboard: LeaderboardRow[];
  liveComments: WallCommentRow[];
  wallClockTick: number;
}

export interface WallEngagementState {
  hearts: WallHeartBurst[];
  hero: WallHeroEvent | null;
  highlightedUserIds: Set<string>;
  photoOfHourPostId: string | null;
  soundEnabled: boolean;
  effectsEnabled: boolean;
  toggleSound: () => void;
}

function heroDuration(kind: WallHeroKind): number {
  switch (kind) {
    case 'comment_spotlight':
      return 5500;
    case 'photo_of_hour':
      return 6500;
    case 'new_leader':
      return 4500;
    default:
      return 3800;
  }
}

export function useWallEngagement({
  settings,
  posts,
  featuredPost,
  leaderboard,
  liveComments,
  wallClockTick,
}: UseWallEngagementParams): WallEngagementState {
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [hearts, setHearts] = useState<WallHeartBurst[]>([]);
  const [hero, setHero] = useState<WallHeroEvent | null>(null);
  const [highlightedUserIds, setHighlightedUserIds] = useState<Set<string>>(new Set());

  const effectsEnabled = settings.effectsEnabled;
  const heroQueueRef = useRef<WallHeroEvent[]>([]);
  const lastHeroAtRef = useRef(0);
  const heroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const milestoneFiredRef = useRef<Set<string>>(new Set());
  const rankCooldownRef = useRef<Map<string, number>>(new Map());
  const lastLikeAtRef = useRef(0);
  const prevLeaderboardRef = useRef<LeaderboardRow[] | null>(null);
  const prevPostCountRef = useRef<number | null>(null);
  const prevFeaturedLikesRef = useRef<number | null>(null);
  const prevCommentIdsRef = useRef<Set<string>>(new Set());
  const spotlightCommentIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const photoOfHour = computePhotoOfHourDetailed(posts);
  const photoOfHourPostId = photoOfHour?.postId ?? null;
  const prevPhotoOfHourRef = useRef<string | null>(null);
  const photoOfHourInitRef = useRef(false);

  const playSound = useCallback(
    (kind: WallSoundKind) => {
      if (effectsEnabled) playWallSound(kind, soundEnabled);
    },
    [effectsEnabled, soundEnabled],
  );

  const clearHeroTimer = useCallback(() => {
    if (heroTimerRef.current) {
      clearTimeout(heroTimerRef.current);
      heroTimerRef.current = null;
    }
  }, []);

  const showHero = useCallback(
    (event: WallHeroEvent) => {
      if (!effectsEnabled) return;
      clearHeroTimer();
      setHero(event);
      lastHeroAtRef.current = Date.now();
      if (event.kind === 'new_leader') playSound('leader');
      else if (event.kind === 'milestone') playSound('milestone');
      else if (event.kind === 'comment_spotlight' || event.kind === 'photo_of_hour') playSound('spotlight');
      if (event.userId) {
        setHighlightedUserIds((prev) => new Set(prev).add(event.userId!));
        setTimeout(() => {
          setHighlightedUserIds((prev) => {
            const next = new Set(prev);
            next.delete(event.userId!);
            return next;
          });
        }, RANK_HIGHLIGHT_MS);
      }
      heroTimerRef.current = setTimeout(() => {
        setHero(null);
        heroTimerRef.current = null;
      }, event.durationMs);
    },
    [clearHeroTimer, effectsEnabled, playSound],
  );

  const tryDequeueHero = useCallback(() => {
    if (!effectsEnabled || hero) return;
    const now = Date.now();
    if (now - lastHeroAtRef.current < MIN_HERO_INTERVAL_MS) return;
    const next = heroQueueRef.current.shift();
    if (next) showHero(next);
  }, [effectsEnabled, hero, showHero]);

  const enqueueHero = useCallback(
    (kind: WallHeroKind, title: string, subtitle?: string, userId?: string, confetti = false) => {
      if (!effectsEnabled) return;
      const event: WallHeroEvent = {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        title,
        subtitle,
        userId,
        durationMs: heroDuration(kind),
        confetti: confetti || kind === 'new_leader',
      };
      heroQueueRef.current.push(event);
      tryDequeueHero();
    },
    [effectsEnabled, tryDequeueHero],
  );

  const pushHeart = useCallback(() => {
    if (!effectsEnabled) return;
    const now = Date.now();
    if (now - lastLikeAtRef.current < LIKE_HEART_COOLDOWN_MS) return;
    lastLikeAtRef.current = now;
    const id = `heart-${now}`;
    setHearts((prev) => [...prev.slice(-2), { id }]);
    playSound('like');
    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => h.id !== id));
    }, 1600);
  }, [effectsEnabled, playSound]);

  const flashRankUp = useCallback((userId: string) => {
    const now = Date.now();
    const last = rankCooldownRef.current.get(userId) ?? 0;
    if (now - last < 15_000) return;
    rankCooldownRef.current.set(userId, now);
    setHighlightedUserIds((prev) => new Set(prev).add(userId));
    setTimeout(() => {
      setHighlightedUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }, RANK_HIGHLIGHT_MS);
  }, []);

  // Leaderboard deltas
  useEffect(() => {
    if (!effectsEnabled) return;
    const prev = prevLeaderboardRef.current;
    prevLeaderboardRef.current = leaderboard;
    if (!initializedRef.current) {
      if (leaderboard.length > 0) initializedRef.current = true;
      return;
    }
    if (!prev?.length || !leaderboard.length) return;

    const leader = detectNewLeader(prev, leaderboard);
    if (leader) {
      enqueueHero('new_leader', `${leader.name} takes the lead!`, 'New #1 on the leaderboard', leader.userId, true);
    }

    for (const up of detectRankUps(prev, leaderboard)) {
      if (up.newRank === 1) continue;
      flashRankUp(up.userId);
      if (up.newRank <= 3) {
        enqueueHero(
          'milestone',
          `${up.name} moved up to #${up.newRank}!`,
          'Climbing the leaderboard',
          up.userId,
        );
      }
    }

    for (const hit of detectMilestones(prev, leaderboard, milestoneFiredRef.current)) {
      const key = milestoneKey(hit.userId, hit.milestone);
      milestoneFiredRef.current.add(key);
      enqueueHero(
        'milestone',
        `${hit.name} hit ${hit.milestone} points!`,
        `${hit.points} total points`,
        hit.userId,
      );
    }
  }, [leaderboard, effectsEnabled, enqueueHero, flashRankUp]);

  // Post count / first photo
  useEffect(() => {
    if (!effectsEnabled) return;
    const count = posts.length;
    const prevCount = prevPostCountRef.current;
    prevPostCountRef.current = count;
    if (prevCount === null) return;
    const first = detectFirstPhoto(prevCount, count, posts[0] ?? null);
    if (first) {
      enqueueHero('first_photo', `${first.name} shared the first photo!`, 'The wall is live', undefined, true);
    }
  }, [posts, effectsEnabled, enqueueHero]);

  // Featured post likes
  useEffect(() => {
    if (!effectsEnabled || !featuredPost) {
      prevFeaturedLikesRef.current = featuredPost?.likes_count ?? null;
      return;
    }
    const likes = featuredPost.likes_count ?? 0;
    const prev = prevFeaturedLikesRef.current;
    prevFeaturedLikesRef.current = likes;
    if (prev === null) return;
    if (likes > prev) pushHeart();
  }, [featuredPost?.id, featuredPost?.likes_count, effectsEnabled, pushHeart, featuredPost]);

  // Photo of the hour — celebrate when a new post takes the lead (most likes in last 60 min)
  useEffect(() => {
    if (!effectsEnabled) return;
    const currentId = photoOfHour?.postId ?? null;
    const prevId = prevPhotoOfHourRef.current;
    prevPhotoOfHourRef.current = currentId;

    if (!photoOfHourInitRef.current) {
      photoOfHourInitRef.current = true;
      return;
    }
    if (!photoOfHour || !currentId || currentId === prevId) return;

    enqueueHero(
      'photo_of_hour',
      `${photoOfHour.name} has the crowd favorite!`,
      `${photoOfHour.likes} like${photoOfHour.likes === 1 ? '' : 's'} in the last hour`,
      undefined,
      true,
    );
  }, [photoOfHour?.postId, photoOfHour?.likes, photoOfHour?.name, effectsEnabled, enqueueHero, photoOfHour]);

  // Hourly reminder if the same photo is still #1
  useEffect(() => {
    if (!effectsEnabled || !photoOfHour || wallClockTick === 0) return;
    if (wallClockTick % 60 !== 0) return;
    enqueueHero(
      'photo_of_hour',
      `Still the crowd favorite — ${photoOfHour.name}!`,
      `${photoOfHour.likes} likes this hour`,
      undefined,
      true,
    );
  }, [wallClockTick, photoOfHour, effectsEnabled, enqueueHero]);

  // Comment spotlight interval (v2)
  useEffect(() => {
    if (!effectsEnabled) return;
    const id = setInterval(() => {
      const comment = pickCommentForSpotlight(liveComments);
      if (!comment || spotlightCommentIdsRef.current.has(comment.id)) return;
      spotlightCommentIdsRef.current.add(comment.id);
      const name = comment.user?.full_name?.trim() || 'Someone';
      const excerpt = comment.content.length > 100 ? `${comment.content.slice(0, 97)}…` : comment.content;
      enqueueHero('comment_spotlight', `"${excerpt}"`, `— ${name}`, undefined);
    }, COMMENT_SPOTLIGHT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [liveComments, effectsEnabled, enqueueHero]);

  // Track new comments for optional quicker spotlight on fresh ones
  useEffect(() => {
    if (!effectsEnabled) return;
    const ids = new Set(liveComments.map((c) => c.id));
    const prev = prevCommentIdsRef.current;
    prevCommentIdsRef.current = ids;
    if (!prev.size) return;
    const newest = liveComments[0];
    if (!newest || prev.has(newest.id) || spotlightCommentIdsRef.current.has(newest.id)) return;
    const text = (newest.content ?? '').trim();
    if (text.length < 12 || text.length > 120) return;
    if (Math.random() > 0.35) return;
    spotlightCommentIdsRef.current.add(newest.id);
    const name = newest.user?.full_name?.trim() || 'Someone';
    enqueueHero('comment_spotlight', `"${text}"`, `— ${name}`, undefined);
  }, [liveComments, effectsEnabled, enqueueHero]);

  // Drain hero queue when current hero ends
  useEffect(() => {
    if (!hero) {
      const t = setTimeout(tryDequeueHero, 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hero, tryDequeueHero]);

  useEffect(() => () => clearHeroTimer(), [clearHeroTimer]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((s) => !s);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('collectivelive-wall-sound', soundEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [soundEnabled]);

  return {
    hearts,
    hero,
    highlightedUserIds,
    photoOfHourPostId,
    soundEnabled,
    effectsEnabled,
    toggleSound,
  };
}
