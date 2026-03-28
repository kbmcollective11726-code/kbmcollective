import { supabase } from './supabase';
import { sendPushToUser } from './pushNotifications';

export type NotificationType =
  | 'like'
  | 'comment'
  | 'message'
  | 'announcement'
  | 'points'
  | 'badge'
  | 'meeting'
  | 'schedule_change'
  | 'connection_request'
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

/**
 * Create an in-app notification and send a push notification so the user receives it on their device.
 * Use this for likes, comments, connection requests, schedule changes, etc.
 */
export async function createNotificationAndPush(
  userId: string,
  eventId: string | null,
  type: NotificationType,
  title: string,
  body?: string | null,
  data?: Record<string, unknown>
): Promise<{ error: string | null }> {
  const result = await createNotification(userId, eventId, type, title, body, data);
  if (result.error) return result;
  // Send push so the user gets a device notification (in-app record already created above)
  const pushResult = await sendPushToUser(userId, title, body ?? '', {
    eventId: eventId ?? undefined,
    postId: data?.post_id as string | undefined,
    chatUserId: data?.chat_user_id as string | undefined,
    groupId: data?.group_id as string | undefined,
    boothId: data?.booth_id as string | undefined,
  });
  if (pushResult.error) {
    console.warn('[notifications] Push failed (in-app notification was saved):', pushResult.error);
  }
  return { error: null };
}
