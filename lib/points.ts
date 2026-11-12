import { supabase } from './supabase';
import { PointAction } from './types';

/**
 * Award points to a user for an action.
 * Checks the event's point rules and daily limits.
 * The database trigger automatically updates event_members.points.
 *
 * When a post is soft-deleted (`posts.is_deleted`), DB trigger `remove_points_on_post_soft_delete`
 * removes the author's `post_photo` row from `point_log` and recalculates their total (migration
 * `20260323120000_remove_post_photo_points_on_soft_delete.sql`).
 */
export async function awardPoints(
  userId: string,
  eventId: string,
  action: PointAction,
  referenceId?: string,
  description?: string
): Promise<{ awarded: boolean; points: number }> {
  try {
    const { data, error } = await supabase.rpc('award_points_secure', {
      p_user_id: userId,
      p_event_id: eventId,
      p_action: action,
      p_reference_id: referenceId ?? null,
      p_description: description ?? null,
    });
    if (error) {
      if (__DEV__) console.warn('Failed to award points:', error.message);
      return { awarded: false, points: 0 };
    }
    const result = data as { awarded?: boolean; points?: number } | null;
    return {
      awarded: result?.awarded === true,
      points: typeof result?.points === 'number' ? result.points : 0,
    };
  } catch (err) {
    if (__DEV__) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Award points error:', message);
    }
    return { awarded: false, points: 0 };
  }
}

/**
 * Get the current user's total points for an event.
 */
export async function getUserPoints(
  userId: string,
  eventId: string
): Promise<number> {
  const { data } = await supabase
    .from('event_members')
    .select('points')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  return data?.points ?? 0;
}

/**
 * Get the leaderboard for an event.
 */
export async function getLeaderboard(
  eventId: string,
  limit: number = 20
): Promise<Array<{ user_id: string; points: number; full_name: string; avatar_url: string | null; rank: number }>> {
  const { data, error } = await supabase
    .from('event_members')
    .select('user_id, points, user:users(full_name, avatar_url)')
    .eq('event_id', eventId)
    .order('points', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((entry: any, index: number) => ({
    user_id: entry.user_id,
    points: entry.points,
    full_name: entry.user?.full_name ?? 'Unknown',
    avatar_url: entry.user?.avatar_url ?? null,
    rank: index + 1,
  }));
}

/**
 * Get the user's rank in the leaderboard.
 */
export async function getUserRank(
  userId: string,
  eventId: string
): Promise<number> {
  const { data } = await supabase
    .from('event_members')
    .select('user_id, points')
    .eq('event_id', eventId)
    .order('points', { ascending: false });

  if (!data) return 0;

  const index = data.findIndex((m: any) => m.user_id === userId);
  return index >= 0 ? index + 1 : 0;
}

/** Default point rule actions when creating a new event or resetting rules. */
export const DEFAULT_POINT_RULE_ACTIONS = [
  'post_photo',
  'give_like',
  'comment',
  'receive_like',
  'receive_comment',
  'give_comment_like',
  'receive_comment_like',
] as const;

/**
 * Initialize default point rules for a new event (core feed engagement rules).
 * Call this when an admin creates a new event or resets to defaults.
 */
export async function initializePointRules(eventId: string): Promise<void> {
  const defaultRules = [
    { action: 'post_photo', points_value: 20, max_per_day: null, description: 'Post a photo' },
    { action: 'give_like', points_value: 5, max_per_day: null, description: "Like someone else's post" },
    { action: 'comment', points_value: 10, max_per_day: null, description: "Comment on someone else's post" },
    { action: 'receive_like', points_value: 5, max_per_day: null, description: 'Someone liked your post' },
    { action: 'receive_comment', points_value: 5, max_per_day: null, description: 'Someone commented on your post' },
    { action: 'give_comment_like', points_value: 5, max_per_day: 30, description: "Like someone else's comment" },
    { action: 'receive_comment_like', points_value: 5, max_per_day: 50, description: 'Someone liked your comment' },
  ];

  const rulesWithEventId = defaultRules.map((rule) => ({
    ...rule,
    event_id: eventId,
  }));

  // Prefer DB helper (idempotent). Fall back to upsert if the RPC is unavailable.
  const { error: rpcError } = await supabase.rpc('seed_default_point_rules_for_event', {
    p_event_id: eventId,
  });
  if (!rpcError) return;

  await supabase.from('point_rules').upsert(rulesWithEventId, {
    onConflict: 'event_id,action',
    ignoreDuplicates: true,
  });
}
