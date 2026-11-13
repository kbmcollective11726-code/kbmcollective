/**
 * Phone-scheduled "starting soon" alarms for 1:1 meetings and agenda sessions, so reminders still
 * fire with no signal or during a server outage.
 *
 * Mirrors the server crons (notify-b2b-meeting-soon / notify-event-starting-soon): same titles, bodies,
 * tap data, recipient rules, and event time zone (events.reminder_timezone, set by admins in cadmin).
 * After scheduling from live data the app records users.local_reminders_at/_until; the crons then skip
 * their push for items the phone covers, and still push anything that changed after that.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';
import { supabase } from './supabase';
import type { Event, ScheduleSession, User } from './types';
import { ensureAndroidNotificationChannel, NOTIFICATION_CHANNEL_ID } from './notificationChannel';
import { getSessionDateKeyFromIso, parseSessionDate, sessionInstantOnEventDayLocal } from './scheduleNowNext';
import { fetchVendorRepBoothIds } from './vendorBoothReps';
import {
  isStringArray,
  loadCachedB2BMeetings,
  loadCachedSessions,
  loadCachedSnapshot,
  snapshotKeys,
} from './eventOfflineCache';

const ALARM_PREFIX = 'phone-reminder-';
/** Older builds scheduled meeting alarms in UTC (wrong time); always cancel them. */
const LEGACY_PREFIX = 'meeting-reminder-';
/** Server windows: meetings ~5 min before (3–9), sessions ~4 min before (2–6). */
const MEETING_LEAD_MS = 5 * 60 * 1000;
const SESSION_LEAD_MS = 4 * 60 * 1000;
/** iOS keeps at most 64 pending local notifications per app. */
const MAX_ALARMS = 60;
/** Same fallback as the crons when an event has no reminder_timezone. */
const DEFAULT_ZONE = 'America/New_York';
/** Report coverage a little early so clock skew errs toward a duplicate push, never a missed one. */
const COVERAGE_SAFETY_MS = 2 * 60 * 1000;
const MIN_RUN_GAP_MS = 60 * 1000;

type Alarm = {
  id: string;
  startMs: number;
  fireMs: number;
  title: string;
  body: string;
  data: Record<string, string>;
};

type SessionInput = Pick<ScheduleSession, 'id' | 'title' | 'start_time' | 'day_number' | 'location' | 'room'>;

type MeetingInput = {
  slotId: string;
  boothId: string;
  startTime: string;
  /** Attendee view: vendor name. Rep view: attendee name. */
  otherName: string;
  isRepView: boolean;
};

let running = false;
let lastRunAt = 0;

function getNotifications(): typeof NotificationsModule | null {
  if (Constants.appOwnership === 'expo' || Platform.OS === 'web') return null;
  try {
    return require('expo-notifications') as typeof NotificationsModule;
  } catch {
    return null;
  }
}

function zoneFor(event: Event): string {
  return (event.reminder_timezone ?? '').trim() || DEFAULT_ZONE;
}

/** Wall-clock start (UTC digits) interpreted in the event time zone, like the crons. */
function startInstantMs(iso: string, zone: string): number | null {
  const d = parseSessionDate(iso);
  const key = getSessionDateKeyFromIso(iso);
  if (!d || !key) return null;
  return sessionInstantOnEventDayLocal(d, key, zone)?.getTime() ?? null;
}

function isNotificationsPaused(event: Event): boolean {
  const ev = event as Event & { notifications_paused?: boolean | null; notifications_paused_until?: string | null };
  if (ev.notifications_paused !== true) return false;
  const untilMs = ev.notifications_paused_until ? Date.parse(ev.notifications_paused_until) : NaN;
  return !Number.isFinite(untilMs) || untilMs > Date.now();
}

function effectiveRoomVenue(location: string | null, room: string | null): string | null {
  const v = (room ?? '').trim() || (location ?? '').trim();
  return v ? v.replace(/\s+/g, ' ').toLowerCase() : null;
}

/** Same recipient rules as notify-event-starting-soon. */
function sessionAlarms(
  sessions: SessionInput[],
  saved: Set<string>,
  user: User,
  zone: string,
  eventId: string,
): Alarm[] {
  const savedOnly = user.session_reminder_saved_only === true;
  const skipSameRoom = user.session_reminder_skip_same_room !== false;
  const alarms: Alarm[] = [];
  for (const s of sessions) {
    const isSaved = saved.has(s.id);
    if (savedOnly && !isSaved) continue;
    const startMs = startInstantMs(s.start_time, zone);
    if (startMs == null) continue;
    if (skipSameRoom && isSaved) {
      let previous: SessionInput | null = null;
      let previousMs = -1;
      for (const other of sessions) {
        if (other.id === s.id || !saved.has(other.id) || (other.day_number ?? 1) !== (s.day_number ?? 1)) continue;
        const ms = startInstantMs(other.start_time, zone);
        if (ms == null || ms >= startMs) continue;
        if (ms > previousMs) {
          previousMs = ms;
          previous = other;
        }
      }
      const prevRoom = previous ? effectiveRoomVenue(previous.location, previous.room) : null;
      const thisRoom = effectiveRoomVenue(s.location, s.room);
      if (prevRoom && thisRoom && prevRoom === thisRoom) continue;
    }
    alarms.push({
      id: `${ALARM_PREFIX}session-${s.id}`,
      startMs,
      fireMs: startMs - SESSION_LEAD_MS,
      title: 'Event starting soon',
      body: `${s.title ?? 'A session'} is starting soon. Check the Agenda.`,
      data: { type: 'session_reminder', event_id: eventId, session_id: s.id, url: 'collectivelive://schedule' },
    });
  }
  return alarms;
}

/** Same wording as notify-b2b-meeting-soon for attendees and booth reps. */
function meetingAlarms(meetings: MeetingInput[], eventId: string, zone: string): Alarm[] {
  const alarms: Alarm[] = [];
  for (const m of meetings) {
    const startMs = startInstantMs(m.startTime, zone);
    if (startMs == null) continue;
    alarms.push({
      id: `${ALARM_PREFIX}meeting-${m.slotId}-${m.isRepView ? 'rep' : 'me'}`,
      startMs,
      fireMs: startMs - MEETING_LEAD_MS,
      title: m.isRepView ? 'Booth meeting starting soon' : 'Meeting starting soon',
      body: m.isRepView
        ? `Meeting with ${m.otherName} is starting soon at your booth.`
        : `Meeting with ${m.otherName} is starting soon.`,
      data: {
        type: 'meeting_reminder',
        boothId: m.boothId,
        slotId: m.slotId,
        event_id: eventId,
        url: `collectivelive://expo/${m.boothId}`,
      },
    });
  }
  return alarms;
}

async function fetchLiveInputs(
  event: Event,
  userId: string,
): Promise<{ sessions: SessionInput[]; saved: Set<string>; meetings: MeetingInput[] }> {
  const [sessionsRes, savedRes, myBookingsRes, repBoothIds] = await Promise.all([
    supabase
      .from('schedule_sessions')
      .select('id, title, start_time, day_number, location, room')
      .eq('event_id', event.id)
      .eq('is_active', true),
    supabase.from('user_schedule').select('session_id').eq('user_id', userId),
    supabase
      .from('meeting_bookings')
      .select('slot_id, meeting_slots(id, booth_id, start_time)')
      .eq('attendee_id', userId)
      .neq('status', 'cancelled'),
    fetchVendorRepBoothIds(event.id, userId),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;
  if (savedRes.error) throw savedRes.error;
  if (myBookingsRes.error) throw myBookingsRes.error;

  type MyRow = { slot_id: string; meeting_slots: { id: string; booth_id: string; start_time: string } | null };
  const mySlots = ((myBookingsRes.data ?? []) as unknown as MyRow[])
    .map((r) => r.meeting_slots)
    .filter((s): s is { id: string; booth_id: string; start_time: string } => !!s);

  const boothIds = [...new Set([...mySlots.map((s) => s.booth_id), ...repBoothIds])];
  const { data: boothRows, error: boothErr } = boothIds.length
    ? await supabase.from('vendor_booths').select('id, vendor_name').eq('event_id', event.id).in('id', boothIds)
    : { data: [], error: null };
  if (boothErr) throw boothErr;
  const vendorName = new Map((boothRows ?? []).map((b: { id: string; vendor_name: string | null }) => [b.id, b.vendor_name ?? 'Vendor']));

  const meetings: MeetingInput[] = mySlots
    .filter((s) => vendorName.has(s.booth_id))
    .map((s) => ({
      slotId: s.id,
      boothId: s.booth_id,
      startTime: s.start_time,
      otherName: vendorName.get(s.booth_id) ?? 'Vendor',
      isRepView: false,
    }));

  // Booth reps get a reminder for every booking at their booth (the cron notifies all reps).
  const repBoothsInEvent = repBoothIds.filter((id) => vendorName.has(id));
  if (repBoothsInEvent.length > 0) {
    const { data: repSlots, error: repErr } = await supabase
      .from('meeting_slots')
      .select('id, booth_id, start_time, meeting_bookings(attendee_id, status)')
      .in('booth_id', repBoothsInEvent);
    if (repErr) throw repErr;
    type RepSlot = {
      id: string;
      booth_id: string;
      start_time: string;
      meeting_bookings: { attendee_id: string; status: string }[] | null;
    };
    const bookings = ((repSlots ?? []) as RepSlot[]).flatMap((slot) =>
      (slot.meeting_bookings ?? [])
        .filter((b) => b.status !== 'cancelled' && b.attendee_id !== userId)
        .map((b) => ({ slot, attendeeId: b.attendee_id })),
    );
    const attendeeIds = [...new Set(bookings.map((b) => b.attendeeId))];
    const { data: people } = attendeeIds.length
      ? await supabase.from('users').select('id, full_name').in('id', attendeeIds)
      : { data: [] };
    const nameById = new Map((people ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name?.trim() || 'An attendee']));
    for (const { slot, attendeeId } of bookings) {
      meetings.push({
        slotId: slot.id,
        boothId: slot.booth_id,
        startTime: slot.start_time,
        otherName: nameById.get(attendeeId) ?? 'An attendee',
        isRepView: true,
      });
    }
  }

  return {
    sessions: (sessionsRes.data ?? []) as SessionInput[],
    saved: new Set((savedRes.data ?? []).map((r: { session_id: string }) => r.session_id)),
    meetings,
  };
}

/** Offline: rebuild from what the app saved (agenda, stars, 1:1 rows). Coverage is not reported. */
async function loadSavedInputs(
  event: Event,
  userId: string,
): Promise<{ sessions: SessionInput[]; saved: Set<string>; meetings: MeetingInput[] }> {
  const [sessions, savedIds, agendaMeetings] = await Promise.all([
    loadCachedSessions(event.id),
    loadCachedSnapshot(snapshotKeys.bookmarks(userId), isStringArray),
    loadCachedB2BMeetings(event.id, userId),
  ]);
  const meetings: MeetingInput[] = (agendaMeetings ?? [])
    .filter((m) => !m.isAdminOverview)
    .map((m) => ({
      slotId: m.id,
      boothId: m.booth_id,
      startTime: m.start_time,
      otherName: m.isVendorMeeting ? m.vendor_name.replace(/^Meeting with\s+/i, '') : m.vendor_name,
      isRepView: m.isVendorMeeting === true,
    }));
  return { sessions: (sessions ?? []) as SessionInput[], saved: new Set(savedIds ?? []), meetings };
}

async function cancelAlarms(Notifications: typeof NotificationsModule): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    const id = n.identifier;
    if (id?.startsWith(ALARM_PREFIX) || id?.startsWith(LEGACY_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  }
}

async function reportCoverage(userId: string, at: Date | null, untilMs: number | null): Promise<void> {
  await supabase
    .from('users')
    .update({
      local_reminders_at: at ? at.toISOString() : null,
      local_reminders_until: at && untilMs != null ? new Date(untilMs).toISOString() : null,
    })
    .eq('id', userId);
}

/**
 * Rebuild the phone's alarms for the current event. Call on app open/resume and whenever the user
 * changes saved sessions or reminder settings (`force` skips the short throttle).
 */
export async function schedulePhoneReminders(event: Event | null, user: User | null, force = false): Promise<void> {
  if (!event?.id || !user?.id || running) return;
  if (!force && Date.now() - lastRunAt < MIN_RUN_GAP_MS) return;
  const Notifications = getNotifications();
  if (!Notifications) return;
  running = true;
  lastRunAt = Date.now();
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      await cancelAlarms(Notifications);
      await reportCoverage(user.id, null, null).catch(() => {});
      return;
    }

    // Anything changed after this moment must still be pushed by the server.
    const fetchedAt = new Date(Date.now() - COVERAGE_SAFETY_MS);
    let inputs: Awaited<ReturnType<typeof fetchLiveInputs>>;
    let live = true;
    try {
      inputs = await fetchLiveInputs(event, user.id);
    } catch {
      live = false;
      // Offline: alarms set earlier from live data are better than a rebuild from saved copies.
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      if (pending.some((n) => n.identifier?.startsWith(ALARM_PREFIX))) {
        for (const n of pending) {
          if (n.identifier?.startsWith(LEGACY_PREFIX)) {
            await Notifications.cancelScheduledNotificationAsync(n.identifier);
          }
        }
        return;
      }
      inputs = await loadSavedInputs(event, user.id);
    }

    const zone = zoneFor(event);
    const now = Date.now();
    const alarms = isNotificationsPaused(event)
      ? []
      : [
          ...meetingAlarms(inputs.meetings, event.id, zone),
          ...sessionAlarms(inputs.sessions, inputs.saved, user, zone, event.id),
        ]
          .filter((a) => a.fireMs > now + 30_000)
          .sort((a, b) => a.fireMs - b.fireMs)
          .slice(0, MAX_ALARMS);

    await ensureAndroidNotificationChannel();
    await cancelAlarms(Notifications);
    for (const a of alarms) {
      await Notifications.scheduleNotificationAsync({
        identifier: a.id,
        content: {
          title: a.title,
          body: a.body,
          data: a.data,
          sound: 'default',
          interruptionLevel: 'active',
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(a.fireMs),
          ...(Platform.OS === 'android' && { channelId: NOTIFICATION_CHANNEL_ID }),
        },
      });
    }

    if (live) {
      // The furthest covered start; items after it (beyond the alarm cap) are still pushed by the server.
      const untilMs = alarms.length > 0 ? Math.max(...alarms.map((a) => a.startMs)) : now;
      await reportCoverage(user.id, fetchedAt, untilMs).catch(() => {});
    }
  } catch (e) {
    if (__DEV__) console.warn('[phoneReminders] schedule failed:', e);
  } finally {
    running = false;
  }
}

/** Logout: remove this user's alarms and let the server push again. */
export async function clearPhoneReminders(userId: string | null | undefined): Promise<void> {
  const Notifications = getNotifications();
  if (Notifications) await cancelAlarms(Notifications).catch(() => {});
  if (userId) await reportCoverage(userId, null, null).catch(() => {});
}
