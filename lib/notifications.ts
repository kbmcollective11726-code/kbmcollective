import { supabase } from './supabase';

export type NotificationType =
  | 'like'
  | 'comment'
  | 'message'
  | 'announcement'
  | 'points'
  | 'badge'
  | 'meeting'
  | 'schedule_change'
  | 'system';

/**
 * Create an in-app notification for a user.
 * Used when someone likes a post, comments, sends a DM, etc.
 */
export async function createNotification(
  userId: string,
  eventId: string | null,
  type: NotificationType,
  title: string,
  body?: string | null,
  data?: Record<string, unknown>
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      event_id: eventId,
      type,
      title,
      body: body ?? null,
      data: data ?? {},
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create notification' };
  }
}
