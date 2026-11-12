import { supabase } from './supabase';

/** Unread 1:1 messages for the current user in an event (receiver + is_read false). */
export async function fetchUnreadDmCount(eventId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('receiver_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

/** Unread DM counts keyed by sender_id. */
export async function fetchUnreadDmCountsBySender(
  eventId: string,
  userId: string
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('event_id', eventId)
    .eq('receiver_id', userId)
    .eq('is_read', false)
    .limit(500);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const senderId = row.sender_id as string;
    if (!senderId) continue;
    map.set(senderId, (map.get(senderId) ?? 0) + 1);
  }
  return map;
}
