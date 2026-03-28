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
    // Look up the point rule for this action in this event
    const { data: rule, error: ruleError } = await supabase
      .from('point_rules')
      .select('points_value, max_per_day')
      .eq('event_id', eventId)
      .eq('action', action)
      .maybeSingle();

    if (ruleError || !rule) {
      console.log(`No point rule found for action: ${action}`);
      return { awarded: false, points: 0 };
    }

    // Check daily limit if one exists
    if (rule.max_per_day) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count, error: countError } = await supabase
        .from('point_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .eq('action', action)
        .gte('created_at', today.toISOString());

      if (!countError && (count ?? 0) >= rule.max_per_day) {
        console.log(`Daily limit reached for action: ${action}`);
        return { awarded: false, points: 0 };
      }
    }

    // Check for duplicate award on the same reference (prevent double-awarding)
    if (referenceId) {
      const { count: dupCount } = await supabase
        .from('point_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .eq('action', action)
        .eq('reference_id', referenceId);

      if ((dupCount ?? 0) > 0) {
        return { awarded: false, points: 0 };
      }
    }

    // For post_photo: prevent duplicate points for same image (same image_hash by same user in same event)
    if (action === 'post_photo' && referenceId) {
      const { data: post } = await supabase
        .from('posts')
        .select('image_hash')
        .eq('id', referenceId)
        .single();

      const imageHash = (post as { image_hash?: string | null } | null)?.image_hash;
      if (imageHash) {
        const { count: sameImageCount } = await supabase
          .from('posts')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .eq('user_id', userId)
          .eq('image_hash', imageHash)
          .neq('id', referenceId)
          .eq('is_deleted', false);

        if ((sameImageCount ?? 0) > 0) {
          return { awarded: false, points: 0 };
        }
      }
    }

    // Award the points — the database trigger updates event_members.points
    const { error: insertError } = await supabase
      .from('point_log')
      .insert({
        user_id: userId,
        event_id: eventId,
        action,
        points: rule.points_value,
        reference_id: referenceId,
        description: description || action.replace(/_/g, ' '),
      });

    if (insertError) {
      console.error('Failed to award points:', insertError);
      return { awarded: false, points: 0 };
    }

    return { awarded: true, points: rule.points_value };
  } catch (err) {
    console.error('Award points error:', err);
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
] as const;

/**
 * Initialize default point rules for a new event (only the 5 core rules).
 * Call this when an admin creates a new event or resets to defaults.
 */
export async function initializePointRules(eventId: string): Promise<void> {
  const defaultRules = [
    { action: 'post_photo', points_value: 20, max_per_day: null, description: 'Post a photo' },
    { action: 'give_like', points_value: 5, max_per_day: null, description: "Like someone else's post" },
    { action: 'comment', points_value: 10, max_per_day: null, description: "Comment on someone else's post" },
    { action: 'receive_like', points_value: 5, max_per_day: null, description: 'Someone liked your post' },
    { action: 'receive_comment', points_value: 5, max_per_day: null, description: 'Someone commented on your post' },
  ];

  const rulesWithEventId = defaultRules.map((rule) => ({
    ...rule,
    event_id: eventId,
  }));

  await supabase.from('point_rules').insert(rulesWithEventId);
}
