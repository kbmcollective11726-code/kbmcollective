import { supabase } from './supabase';
import type { Event, Post } from './types';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';

/** Load one post for the comment sheet (notification / deep link). No is_approved filter. */
export async function loadPostForCommentSheet(
  postId: string,
  eventId: string,
  userId: string,
  isBlockedUser: (uid: string) => boolean
): Promise<Post | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(
      'id, event_id, user_id, image_url, caption, image_hash, likes_count, comments_count, is_pinned, is_approved, is_deleted, created_at, user:users(id, full_name, avatar_url)'
    )
    .eq('id', postId)
    .eq('event_id', eventId)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const authorId = String(row.user_id ?? '');
  if (isBlockedUser(authorId)) return null;

  const uRaw = row.user;
  const userObj = Array.isArray(uRaw) ? uRaw[0] ?? null : uRaw;

  const { data: likeRow } = await supabase
    .from('likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  return {
    ...(row as object),
    user: userObj,
    user_liked: !!likeRow,
  } as Post;
}

export async function ensureEventForNotification(notificationEventId: string): Promise<boolean> {
  const { currentEvent, memberships, setCurrentEvent } = useEventStore.getState();
  if (currentEvent?.id === notificationEventId) return true;
  const isMember = memberships.some((m) => m.event_id === notificationEventId);
  const isAdmin = useAuthStore.getState().user?.is_platform_admin;
  if (!isMember && !isAdmin) return false;
  const { data: ev, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', notificationEventId)
    .maybeSingle();
  if (error || !ev) return false;
  await setCurrentEvent(ev as Event);
  return true;
}

export async function resolveEventForOpenPost(
  postId: string,
  hintEventId: string | null | undefined
): Promise<boolean> {
  let evId = hintEventId?.trim() || null;
  if (!evId) {
    const { data } = await supabase
      .from('posts')
      .select('event_id')
      .eq('id', postId)
      .eq('is_deleted', false)
      .maybeSingle();
    evId = (data as { event_id?: string } | null)?.event_id ?? null;
  }
  if (!evId) return false;
  return ensureEventForNotification(evId);
}
