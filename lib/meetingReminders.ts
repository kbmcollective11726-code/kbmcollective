import { Platform } from 'react-native';
import Constants from 'expo-constants';

const MEETING_REMINDER_PREFIX = 'meeting-reminder-';
const ANDROID_CHANNEL_ID = 'collectivelive_notifications_v2';
const REMIND_MINUTES = 5;

export type MeetingToRemind = {
  slotId?: string;
  boothId: string;
  startTime: string;
  endTime: string;
  vendorName: string;
};

/**
 * Schedule local notifications for B2B meetings: "Meeting with [Vendor] starts in 5 minutes."
 * Call when the user's upcoming meetings are loaded (e.g. B2B list or booth detail).
 * Cancels any previously scheduled meeting reminders and reschedules for the current list.
 */
export async function scheduleMeetingReminders(meetings: MeetingToRemind[]): Promise<void> {
  if (Constants.appOwnership === 'expo') return; // Expo Go: local schedule may not persist
  try {
    const Notifications = require('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    await cancelAllMeetingReminders();

    const now = Date.now();
    const triggerMs = REMIND_MINUTES * 60 * 1000;

    for (const m of meetings) {
      const startDate = parseMeetingTime(m.startTime);
      if (!startDate) continue;
      const remindAt = startDate.getTime() - triggerMs;
      if (remindAt <= now) continue; // already past reminder time
      const identifier = `${MEETING_REMINDER_PREFIX}${m.boothId}-${m.startTime}`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Meeting starting soon',
          body: `Meeting with ${m.vendorName} starts in ${REMIND_MINUTES} minutes.`,
          data: { type: 'meeting_reminder', boothId: m.boothId, slotId: m.slotId },
          sound: true,
          ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL_ID }),
        },
        trigger: { date: new Date(remindAt) },
        identifier,
      });
    }
  } catch (e) {
    console.warn('Meeting reminders schedule error:', e);
  }
}

/**
 * Cancel all scheduled meeting-reminder notifications (e.g. before rescheduling).
 */
export async function cancelAllMeetingReminders(): Promise<void> {
  if (Constants.appOwnership === 'expo') return; // Expo Go: scheduling APIs may be limited
  try {
    const Notifications = require('expo-notifications');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      const id = (n as { identifier?: string }).identifier;
      if (id?.startsWith(MEETING_REMINDER_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(id);
      }
    }
  } catch (e) {
    console.warn('Cancel meeting reminders error:', e);
  }
}

function parseMeetingTime(isoOrSpace: string): Date | null {
  try {
    const normalized = isoOrSpace.replace(' ', 'T');
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
