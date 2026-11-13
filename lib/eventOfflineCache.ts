import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Event, ScheduleSession, VendorBooth } from './types';

const eventKey = (eventId: string) => `collectivelive_event_cache_${eventId}`;
const sessionsKey = (eventId: string) => `collectivelive_sessions_cache_${eventId}`;
const b2bKey = (eventId: string, userId: string) =>
  `collectivelive_b2b_cache_${eventId}_${userId}`;
const leaderboardKey = (eventId: string) => `collectivelive_leaderboard_cache_${eventId}`;
const expoKey = (eventId: string, userId: string) =>
  `collectivelive_expo_cache_${eventId}_${userId}`;
const communityKey = (eventId: string, userId: string) =>
  `collectivelive_community_cache_${eventId}_${userId}`;

/** Shape stored for Agenda 1:1 rows (per user — bookings differ by attendee/vendor). */
export type CachedB2BMeeting = {
  type: 'b2b';
  id: string;
  booth_id: string;
  vendor_name: string;
  start_time: string;
  end_time: string;
  dateKey: string;
  isVendorMeeting?: boolean;
  isAdminOverview?: boolean;
};

/** Rank / leaderboard row snapshot. */
export type CachedLeaderboardRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  points: number;
  rank: number;
};

/** 1:1 Meetings (Expo) tab snapshot — per user (attendee vs vendor views differ). */
export type CachedExpoBooth = {
  id: string;
  event_id: string;
  vendor_name: string;
  description: string | null;
  logo_url: string | null;
  booth_location: string | null;
  contact_user_id: string | null;
  website: string | null;
  is_active: boolean;
  created_at: string;
  meetingStart?: string;
  meetingEnd?: string;
  meetingSlotId?: string;
  representatives?: {
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
    company?: string | null;
    title?: string | null;
  }[];
};

export type CachedExpoRepAttendee = {
  id: string;
  full_name: string | null;
  company: string | null;
  title: string | null;
  avatar_url: string | null;
  meetingTimes: { start: string; end: string; bookingId: string }[];
};

export type CachedExpoPage = {
  booths: CachedExpoBooth[];
  repAttendees: CachedExpoRepAttendee[];
  isVendorRep: boolean;
  ratedMeetingSlotIds: string[];
};

/** Persist event row so Info can still show basics if Supabase is unreachable. */
export async function saveCachedEvent(event: Event): Promise<void> {
  if (!event?.id) return;
  try {
    await AsyncStorage.setItem(eventKey(event.id), JSON.stringify(event));
  } catch {
    // ignore cache write failures
  }
}

export async function loadCachedEvent(eventId: string): Promise<Event | null> {
  if (!eventId) return null;
  try {
    const raw = await AsyncStorage.getItem(eventKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Event;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist agenda sessions. Overwritten on every successful live fetch. */
export async function saveCachedSessions(
  eventId: string,
  sessions: ScheduleSession[],
): Promise<void> {
  if (!eventId) return;
  try {
    await AsyncStorage.setItem(
      sessionsKey(eventId),
      JSON.stringify({ savedAt: Date.now(), sessions }),
    );
  } catch {
    // ignore
  }
}

export async function loadCachedSessions(eventId: string): Promise<ScheduleSession[] | null> {
  if (!eventId) return null;
  try {
    const raw = await AsyncStorage.getItem(sessionsKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessions?: ScheduleSession[] };
    return Array.isArray(parsed.sessions) ? parsed.sessions : null;
  } catch {
    return null;
  }
}

/** Persist 1:1 / B2B agenda rows for this user. Overwritten on every successful live fetch. */
export async function saveCachedB2BMeetings(
  eventId: string,
  userId: string,
  meetings: CachedB2BMeeting[],
): Promise<void> {
  if (!eventId || !userId) return;
  try {
    await AsyncStorage.setItem(
      b2bKey(eventId, userId),
      JSON.stringify({ savedAt: Date.now(), meetings }),
    );
  } catch {
    // ignore
  }
}

export async function loadCachedB2BMeetings(
  eventId: string,
  userId: string,
): Promise<CachedB2BMeeting[] | null> {
  if (!eventId || !userId) return null;
  try {
    const raw = await AsyncStorage.getItem(b2bKey(eventId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { meetings?: CachedB2BMeeting[] };
    if (!Array.isArray(parsed.meetings)) return null;
    return parsed.meetings.filter(
      (m) =>
        m &&
        m.type === 'b2b' &&
        typeof m.id === 'string' &&
        typeof m.booth_id === 'string' &&
        typeof m.start_time === 'string' &&
        typeof m.end_time === 'string',
    );
  } catch {
    return null;
  }
}

/** Persist Rank list. Overwritten on every successful live fetch. */
export async function saveCachedLeaderboard(
  eventId: string,
  rows: CachedLeaderboardRow[],
): Promise<void> {
  if (!eventId) return;
  try {
    await AsyncStorage.setItem(
      leaderboardKey(eventId),
      JSON.stringify({ savedAt: Date.now(), rows }),
    );
  } catch {
    // ignore
  }
}

export async function loadCachedLeaderboard(
  eventId: string,
): Promise<CachedLeaderboardRow[] | null> {
  if (!eventId) return null;
  try {
    const raw = await AsyncStorage.getItem(leaderboardKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: CachedLeaderboardRow[] };
    if (!Array.isArray(parsed.rows)) return null;
    return parsed.rows.filter(
      (r) =>
        r &&
        typeof r.user_id === 'string' &&
        typeof r.full_name === 'string' &&
        typeof r.points === 'number' &&
        typeof r.rank === 'number',
    );
  } catch {
    return null;
  }
}

/** Persist 1:1 Meetings tab for this user. Overwritten on every successful live fetch. */
export async function saveCachedExpoPage(
  eventId: string,
  userId: string,
  page: CachedExpoPage,
): Promise<void> {
  if (!eventId || !userId) return;
  try {
    await AsyncStorage.setItem(
      expoKey(eventId, userId),
      JSON.stringify({ savedAt: Date.now(), page }),
    );
  } catch {
    // ignore
  }
}

export async function loadCachedExpoPage(
  eventId: string,
  userId: string,
): Promise<CachedExpoPage | null> {
  if (!eventId || !userId) return null;
  try {
    const raw = await AsyncStorage.getItem(expoKey(eventId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { page?: CachedExpoPage };
    const page = parsed.page;
    if (!page || !Array.isArray(page.booths) || !Array.isArray(page.repAttendees)) return null;
    return {
      booths: page.booths,
      repAttendees: page.repAttendees,
      isVendorRep: page.isVendorRep === true,
      ratedMeetingSlotIds: Array.isArray(page.ratedMeetingSlotIds)
        ? page.ratedMeetingSlotIds.filter((id) => typeof id === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/** Community member row snapshot (includes connection flags at save time). */
export type CachedCommunityMember = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
  company: string | null;
  role: string;
  roles?: string[];
  is_connected: boolean;
  request_sent_by_me: boolean;
  request_received_from_them: boolean;
};

/** Persist Community list for this user. Overwritten on every successful live fetch. */
export async function saveCachedCommunity(
  eventId: string,
  userId: string,
  members: CachedCommunityMember[],
): Promise<void> {
  if (!eventId || !userId) return;
  try {
    await AsyncStorage.setItem(
      communityKey(eventId, userId),
      JSON.stringify({ savedAt: Date.now(), members }),
    );
  } catch {
    // ignore
  }
}

export async function loadCachedCommunity(
  eventId: string,
  userId: string,
): Promise<CachedCommunityMember[] | null> {
  if (!eventId || !userId) return null;
  try {
    const raw = await AsyncStorage.getItem(communityKey(eventId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { members?: CachedCommunityMember[] };
    if (!Array.isArray(parsed.members)) return null;
    return parsed.members.filter(
      (m) =>
        m &&
        typeof m.user_id === 'string' &&
        typeof m.full_name === 'string' &&
        typeof m.role === 'string',
    );
  } catch {
    return null;
  }
}

const feedKey = (eventId: string, userId: string) =>
  `collectivelive_feed_cache_${eventId}_${userId}`;

/** First-page Feed snapshot (liked flags as of last successful fetch). */
export type CachedFeedPost = {
  id: string;
  event_id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  image_hash: string | null;
  likes_count: number;
  comments_count: number;
  is_pinned: boolean;
  is_approved: boolean;
  is_deleted: boolean;
  created_at: string;
  user_liked?: boolean;
  user?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
};

const FEED_CACHE_MAX = 25;

/** Persist Feed first page for this user. Overwritten on every successful live first-page fetch. */
export async function saveCachedFeed(
  eventId: string,
  userId: string,
  posts: CachedFeedPost[],
): Promise<void> {
  if (!eventId || !userId) return;
  try {
    const slim = posts.slice(0, FEED_CACHE_MAX).map((p) => ({
      id: p.id,
      event_id: p.event_id,
      user_id: p.user_id,
      image_url: p.image_url,
      caption: p.caption ?? null,
      image_hash: p.image_hash ?? null,
      likes_count: p.likes_count ?? 0,
      comments_count: p.comments_count ?? 0,
      is_pinned: !!p.is_pinned,
      is_approved: p.is_approved !== false,
      is_deleted: !!p.is_deleted,
      created_at: p.created_at,
      user_liked: !!p.user_liked,
      user: p.user
        ? {
            id: p.user.id,
            full_name: p.user.full_name,
            avatar_url: p.user.avatar_url ?? null,
          }
        : null,
    }));
    await AsyncStorage.setItem(
      feedKey(eventId, userId),
      JSON.stringify({ savedAt: Date.now(), posts: slim }),
    );
  } catch {
    // ignore
  }
}

// ---- Small per-user snapshots (stars, booth pages, notifications, announcements, profiles) ----

/** Keys are always scoped to the signed-in user so a shared phone never shows another user's copy. */
export const snapshotKeys = {
  bookmarks: (userId: string) => `collectivelive_bookmarks_cache_${userId}`,
  booth: (boothId: string, userId: string) => `collectivelive_booth_cache_${boothId}_${userId}`,
  solutionProvider: (boothId: string, userId: string) =>
    `collectivelive_solution_provider_cache_${boothId}_${userId}`,
  solutionProviderList: (eventId: string, userId: string) =>
    `collectivelive_solution_provider_list_cache_${eventId}_${userId}`,
  notifications: (eventId: string, userId: string) =>
    `collectivelive_notifications_cache_${eventId}_${userId}`,
  announcements: (eventId: string, userId: string) =>
    `collectivelive_announcements_cache_${eventId}_${userId}`,
  profile: (profileUserId: string, viewerId: string) =>
    `collectivelive_profile_view_cache_${profileUserId}_${viewerId}`,
};

export async function saveCachedSnapshot<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Best-effort cache
  }
}

/** Returns the saved value only if it passes `isValid` (guards against old or corrupt shapes). */
export async function loadCachedSnapshot<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown };
    return isValid(parsed?.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Minimal shape check for vendor_booths rows read back from the cache. */
export function isBoothRowArray(value: unknown): value is VendorBooth[] {
  return (
    Array.isArray(value) &&
    value.every(
      (b) =>
        b &&
        typeof (b as VendorBooth).id === 'string' &&
        typeof (b as VendorBooth).event_id === 'string' &&
        typeof (b as VendorBooth).vendor_name === 'string',
    )
  );
}

export async function loadCachedFeed(
  eventId: string,
  userId: string,
): Promise<CachedFeedPost[] | null> {
  if (!eventId || !userId) return null;
  try {
    const raw = await AsyncStorage.getItem(feedKey(eventId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { posts?: CachedFeedPost[] };
    if (!Array.isArray(parsed.posts)) return null;
    return parsed.posts.filter(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.event_id === 'string' &&
        typeof p.user_id === 'string' &&
        typeof p.image_url === 'string' &&
        typeof p.created_at === 'string' &&
        !p.is_deleted,
    );
  } catch {
    return null;
  }
}
