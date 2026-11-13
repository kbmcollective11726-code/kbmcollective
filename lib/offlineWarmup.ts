/**
 * Save the key screens on the phone when the app opens online, so they work during an
 * outage even if the user never visited them. Runs at most every WARMUP_INTERVAL_MS per
 * event/user, only while the app is open, and only re-reads data the user can already see.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Event, ScheduleSession, VendorBooth } from './types';
import { isAppMenuItemVisible } from './effectiveEventMenu';
import {
  PUBLISHED_ANNOUNCEMENT_OR_FILTER,
  sortAnnouncementsNewestFirst,
  type AnnouncementListRow,
} from './announcementVisibility';
import { fetchEventNotificationRows } from './notificationRows';
import { fetchBoothRepresentatives } from './vendorBoothReps';
import { getSessionDateKeyFromIso } from './scheduleNowNext';
import {
  isBoothPageSnapshot,
  loadCachedB2BMeetings,
  loadCachedSnapshot,
  saveCachedB2BMeetings,
  saveCachedSessions,
  saveCachedSnapshot,
  snapshotKeys,
  type BoothPageSnapshot,
  type CachedB2BMeeting,
} from './eventOfflineCache';

const WARMUP_INTERVAL_MS = 20 * 60 * 1000;
/** Cap per run so a vendor-heavy schedule doesn't fan out into many requests. */
const MAX_BOOTH_PAGES = 15;
const lastRunKey = (eventId: string, userId: string) => `collectivelive_warmup_cache_${eventId}_${userId}`;

let running = false;

export async function warmOfflineCaches(event: Event, userId: string): Promise<void> {
  if (running || !event?.id || !userId) return;
  const runKey = lastRunKey(event.id, userId);
  try {
    const last = Number(await AsyncStorage.getItem(runKey));
    if (Number.isFinite(last) && Date.now() - last < WARMUP_INTERVAL_MS) return;
  } catch {
    // Treat as never run
  }

  running = true;
  try {
    const showProviders = isAppMenuItemVisible(event, 'menu_show_solution_providers');
    const show1on1 = isAppMenuItemVisible(event, 'menu_show_1on1');
    const tasks: Promise<unknown>[] = [
      warmAgenda(event.id),
      warmBookmarks(userId),
      warmAnnouncements(event.id, userId),
      warmNotifications(event.id, userId),
    ];
    if (showProviders || show1on1) {
      tasks.push(
        fetchActiveBooths(event.id).then(async (booths) => {
          if (showProviders) {
            await saveCachedSnapshot(snapshotKeys.solutionProviderList(event.id, userId), booths);
          }
          if (show1on1) await warmMyMeetings(event.id, userId, booths);
        }),
      );
    }
    const results = await Promise.allSettled(tasks);
    // Only throttle after a full success, so an offline launch retries on the next open.
    if (results.every((r) => r.status === 'fulfilled')) {
      await AsyncStorage.setItem(runKey, String(Date.now()));
    }
  } finally {
    running = false;
  }
}

async function warmAgenda(eventId: string): Promise<void> {
  const { data, error } = await supabase
    .from('schedule_sessions')
    .select('*')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('day_number', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  await saveCachedSessions(eventId, (data ?? []) as ScheduleSession[]);
}

async function warmBookmarks(userId: string): Promise<void> {
  const { data, error } = await supabase.from('user_schedule').select('session_id').eq('user_id', userId);
  if (error) throw error;
  const ids = (data ?? []).map((r: { session_id: string }) => r.session_id);
  await saveCachedSnapshot(snapshotKeys.bookmarks(userId), ids);
}

async function warmAnnouncements(eventId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, content, created_at, sent_at, scheduled_at')
    .eq('event_id', eventId)
    .or(PUBLISHED_ANNOUNCEMENT_OR_FILTER)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = sortAnnouncementsNewestFirst((data ?? []) as AnnouncementListRow[]);
  await saveCachedSnapshot(snapshotKeys.announcements(eventId, userId), rows);
}

async function warmNotifications(eventId: string, userId: string): Promise<void> {
  const rows = await fetchEventNotificationRows(userId, eventId);
  await saveCachedSnapshot(snapshotKeys.notifications(eventId, userId), rows);
}

async function fetchActiveBooths(eventId: string): Promise<VendorBooth[]> {
  const { data, error } = await supabase
    .from('vendor_booths')
    .select('*')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('vendor_name');
  if (error) throw error;
  return (data ?? []) as VendorBooth[];
}

/** The user's own 1:1s: Agenda rows plus a booth page per meeting booth (details, times, reps). */
async function warmMyMeetings(eventId: string, userId: string, booths: VendorBooth[]): Promise<void> {
  const { data, error } = await supabase
    .from('meeting_bookings')
    .select('id, slot_id, meeting_slots(id, booth_id, start_time, end_time)')
    .eq('attendee_id', userId)
    .neq('status', 'cancelled');
  if (error) throw error;

  type Row = {
    id: string;
    slot_id: string;
    meeting_slots: { id: string; booth_id: string; start_time: string; end_time: string } | null;
  };
  const boothById = new Map(booths.map((b) => [b.id, b]));
  const mine = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.meeting_slots && boothById.has(r.meeting_slots.booth_id),
  );

  // Agenda: only fill in for plain attendees; vendor/admin agendas carry rows this can't rebuild.
  const existingAgenda = await loadCachedB2BMeetings(eventId, userId);
  const agendaHasRepOrAdminRows = (existingAgenda ?? []).some((m) => m.isVendorMeeting || m.isAdminOverview);
  if (!agendaHasRepOrAdminRows) {
    const agendaRows: CachedB2BMeeting[] = mine.map((r) => {
      const slot = r.meeting_slots!;
      return {
        type: 'b2b',
        id: slot.id,
        booth_id: slot.booth_id,
        vendor_name: boothById.get(slot.booth_id)?.vendor_name ?? '1:1 meeting',
        start_time: slot.start_time,
        end_time: slot.end_time,
        dateKey: getSessionDateKeyFromIso(slot.start_time) ?? '',
      };
    });
    await saveCachedB2BMeetings(eventId, userId, agendaRows);
  }

  const meetingBoothIds = [...new Set(mine.map((r) => r.meeting_slots!.booth_id))].slice(0, MAX_BOOTH_PAGES);
  await Promise.all(
    meetingBoothIds.map(async (boothId) => {
      const booth = boothById.get(boothId)!;
      const key = snapshotKeys.booth(boothId, userId);
      const existing = await loadCachedSnapshot(key, isBoothPageSnapshot);
      // A copy saved from a rep/admin view has more detail than this attendee rebuild.
      if (existing && (existing.canViewAllMeetings || existing.isAdmin)) return;
      const reps = await fetchBoothRepresentatives(booth, supabase).catch(() => existing?.boothReps ?? []);
      const snapshot: BoothPageSnapshot = {
        booth,
        slots: mine
          .filter((r) => r.meeting_slots!.booth_id === boothId)
          .map((r) => {
            const slot = r.meeting_slots!;
            return {
              id: slot.id,
              booth_id: boothId,
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_available: false,
              created_at: '',
              myBooking: {
                id: r.id,
                slot_id: slot.id,
                attendee_id: userId,
                status: 'confirmed',
                notes: null,
                created_at: '',
              },
              bookings: [],
            };
          }),
        boothReps: reps,
        canViewAllMeetings: false,
        isAdmin: false,
        feedbackBookingIds: existing?.feedbackBookingIds ?? [],
        feedbackSlotIds: existing?.feedbackSlotIds ?? [],
        feedbackTimeKeys: existing?.feedbackTimeKeys ?? [],
      };
      await saveCachedSnapshot(key, snapshot);
    }),
  );
}
