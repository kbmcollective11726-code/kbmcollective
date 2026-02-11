import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

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
    if (!token) return;

    await supabase.from('users').update({ push_token: token }).eq('id', userId);
  } catch (err) {
    console.warn('Push registration failed:', err);
  }
}

/**
 * Ask the Edge Function to send push notifications to recipients for an announcement.
 * Requires a valid session (access_token). Recipients must have push_token set.
 */
export async function sendAnnouncementPush(
  accessToken: string,
  eventId: string,
  title: string,
  body: string,
  recipientUserIds: string[]
): Promise<{ sent: number; error?: string }> {
  if (!SUPABASE_URL || recipientUserIds.length === 0) {
    return { sent: 0 };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_id: eventId,
        title,
        body,
        recipient_user_ids: recipientUserIds,
      }),
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
