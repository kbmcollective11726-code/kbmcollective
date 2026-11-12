import type { Post } from './types';

const RECENT_POST_TTL_MS = 60_000;

interface RecentPostEntry {
  post: Post;
  publishedAt: number;
}

type RecentPostListener = (post: Post) => void;

const recentPosts = new Map<string, RecentPostEntry>();
const listeners = new Set<RecentPostListener>();

function pruneExpiredPosts(now: number): void {
  for (const [postId, entry] of recentPosts) {
    if (now - entry.publishedAt > RECENT_POST_TTL_MS) {
      recentPosts.delete(postId);
    }
  }
}

export function publishRecentFeedPost(post: Post): void {
  const now = Date.now();
  pruneExpiredPosts(now);
  recentPosts.set(post.id, { post, publishedAt: now });
  for (const listener of listeners) listener(post);
}

export function getRecentFeedPosts(eventId: string): Post[] {
  const now = Date.now();
  pruneExpiredPosts(now);
  return [...recentPosts.values()]
    .filter((entry) => entry.post.event_id === eventId)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .map((entry) => entry.post);
}

export function mergeRecentFeedPosts(eventId: string, fetchedPosts: Post[]): Post[] {
  const recent = getRecentFeedPosts(eventId);
  if (recent.length === 0) return fetchedPosts;
  const recentIds = new Set(recent.map((post) => post.id));
  return [...recent, ...fetchedPosts.filter((post) => !recentIds.has(post.id))];
}

export function removeRecentFeedPost(postId: string): void {
  recentPosts.delete(postId);
}

export function subscribeToRecentFeedPosts(listener: RecentPostListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
