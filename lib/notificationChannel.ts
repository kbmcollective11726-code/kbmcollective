import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Must match ANDROID_CHANNEL_ID in Supabase Edge Functions (send-announcement-push, cron reminders, etc.).
 */
export const NOTIFICATION_CHANNEL_ID = 'collectivelive_notifications_v2';

/**
 * Android 8+: sound and vibration follow the channel. Create/update before first push token registration
 * so remote notifications always target a channel with MAX importance + default sound + vibrate.
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Constants.appOwnership === 'expo' || Platform.OS !== 'android') return;
  try {
    const Notifications = require('expo-notifications');
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Event alerts',
      description: 'Social, announcements, schedule & B2B meeting reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      enableVibrate: true,
      sound: 'default',
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: {
          enforceAudibility: false,
          requestHardwareAudioVideoSynchronization: false,
        },
      },
      enableLights: true,
      lightColor: '#2563eb',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
      showBadge: true,
    });
  } catch (e) {
    console.warn('[notifications] Android channel setup failed:', e);
  }
}
