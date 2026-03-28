import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Set the app icon badge count (red dot number). Call with 0 to clear.
 * Skipped in Expo Go. Keeps badge in sync with unread notifications.
 */
export async function setAppBadgeCount(count: number): Promise<void> {
  if (Constants.appOwnership === 'expo') return;
  try {
    const Notifications = require('expo-notifications');
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch {
    // ignore (e.g. not supported on this device)
  }
}

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();

/**
 * Register for push notifications and save the Expo push token to the user's profile.
 * Call when the user is logged in. Skipped in Expo Go (push not supported in SDK 53+).
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (!Device.isDevice) return;
  if (Constants.appOwnership === 'expo') return;

  try {
    const Notifications = require('expo-notifications');
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return;

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId ?? undefined,
    });
    const token = tokenResult?.data;
    if (!token) {
      if (__DEV__) console.warn('[push] No Expo push token from device (check EAS projectId and a real device build).');
      return;
    }

    const { error } = await supabase.from('users').update({ push_token: token }).eq('id', userId);
    if (error) {
      console.warn('[push] Could not save push_token to profile:', error.message);
      return;
    }
    if (__DEV__) console.log('[push] Token registered for user', userId.slice(0, 8) + '…');
  } catch (err) {
    console.warn('Push registration failed:', err);
  }
}

/**
 * Send a push notification to a single user (like, comment, connection request, schedule change).
 * Gets the current session and calls the send-announcement-push Edge Function.
 * Call after createNotification() so the user gets both in-app and device push.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  options?: { eventId?: string; postId?: string; chatUserId?: string; groupId?: string; boothId?: string }
): Promise<{ sent: number; error?: string }> {
  if (!SUPABASE_URL) return { sent: 0 };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { sent: 0 };
    const eventId = options?.eventId ?? '';
    return sendAnnouncementPush(session.access_token, eventId, title, body ?? '', [userId], {
      postId: options?.postId,
      chatUserId: options?.chatUserId,
      groupId: options?.groupId,
      boothId: options?.boothId,
    });
  } catch {
    return { sent: 0 };
  }
}

/**
 * Ask the Edge Function to send push notifications to recipients.
 * Used for likes, comments, and announcements. Recipients must have push_token set.
 * Includes sound and vibration in the push payload.
 */
export async function sendAnnouncementPush(
  accessToken: string,
  eventId: string,
  title: string,
  body: string,
  recipientUserIds: string[],
  options?: { postId?: string; chatUserId?: string; groupId?: string; boothId?: string }
): Promise<{ sent: number; error?: string }> {
  if (!SUPABASE_URL || recipientUserIds.length === 0) {
    return { sent: 0 };
  }
  try {
    const payload: Record<string, unknown> = {
      event_id: eventId,
      title,
      body,
      recipient_user_ids: recipientUserIds,
    };
    if (options?.postId) payload.post_id = options.postId;
    if (options?.chatUserId) payload.chat_user_id = options.chatUserId;
    if (options?.groupId) payload.group_id = options.groupId;
    if (options?.boothId) payload.booth_id = options.boothId;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { sent: 0, error: data?.error ?? res.statusText };
    }
    return { sent: data?.sent ?? 0 };
  } catch (err) {
    return { sent: 0, error: err instanceof Error ? err.message : 'Request failed' };
  }
}
