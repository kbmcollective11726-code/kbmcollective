/** Keys stored in events.admin_console_tiles (Postgres text[]). */
export type EventAdminConsoleTileId =
  | 'members'
  | 'schedule'
  | 'agenda_print'
  | 'vendor_booths'
  | 'meetings'
  | 'announcements'
  | 'dashboard'
  | 'b2b_feedback'
  | 'session_feedback'
  | 'photos'
  | 'sponsors'
  | 'matchmaking'
  | 'badges'
  | 'scan_log'
  | 'session_attendance'
  | 'safety';

export const DEFAULT_EVENT_ADMIN_CONSOLE_TILES: EventAdminConsoleTileId[] = [
  'members',
  'schedule',
  'agenda_print',
  'photos',
  'announcements',
];

export const ALL_EVENT_ADMIN_CONSOLE_TILE_IDS: EventAdminConsoleTileId[] = [
  'members',
  'schedule',
  'agenda_print',
  'vendor_booths',
  'meetings',
  'announcements',
  'dashboard',
  'b2b_feedback',
  'session_feedback',
  'photos',
  'sponsors',
  'matchmaking',
  'badges',
  'scan_log',
  'session_attendance',
  'safety',
];

const VALID_TILE_IDS = new Set<string>(ALL_EVENT_ADMIN_CONSOLE_TILE_IDS);

/** Stored on events created before announcements was included in the column default. */
const LEGACY_DEFAULT_TILES_WITHOUT_ANNOUNCEMENTS: EventAdminConsoleTileId[] = [
  'members',
  'schedule',
  'agenda_print',
  'photos',
];

function isLegacyDefaultWithoutAnnouncements(tiles: EventAdminConsoleTileId[]): boolean {
  if (tiles.length !== LEGACY_DEFAULT_TILES_WITHOUT_ANNOUNCEMENTS.length) return false;
  const set = new Set(tiles);
  return LEGACY_DEFAULT_TILES_WITHOUT_ANNOUNCEMENTS.every((id) => set.has(id));
}

export interface EventAdminConsoleTileDef {
  id: EventAdminConsoleTileId;
  title: string;
  desc: string;
  to: (eventId: string) => string;
}

export const EVENT_ADMIN_CONSOLE_TILES: EventAdminConsoleTileDef[] = [
  {
    id: 'members',
    title: 'Members',
    desc: 'View members or add from CSV (batch)',
    to: (eventId) => `/events/${eventId}/members`,
  },
  {
    id: 'schedule',
    title: 'Schedule',
    desc: 'Add sessions or import from CSV (batch)',
    to: (eventId) => `/events/${eventId}/schedule`,
  },
  {
    id: 'agenda_print',
    title: 'Printable agenda',
    desc: 'At-a-glance program layout for PDF or paper — matches in-app agenda',
    to: (eventId) => `/events/${eventId}/agenda-print`,
  },
  {
    id: 'vendor_booths',
    title: 'Solution Providers',
    desc: 'Add and edit booths — powers the in-app Solution Providers list and 1:1 Meetings',
    to: (eventId) => `/events/${eventId}/vendor-booths`,
  },
  {
    id: 'meetings',
    title: 'Meetings',
    desc: 'Assign 1:1 Meetings by booth — custom time per delegate; in-app + push notification each assignment',
    to: (eventId) => `/events/${eventId}/meetings`,
  },
  {
    id: 'announcements',
    title: 'Announcements',
    desc: 'Send announcements and push notifications to event members',
    to: (eventId) => `/events/${eventId}/announcements`,
  },
  {
    id: 'dashboard',
    title: 'Member dashboard',
    desc: 'Session & 1:1 Meeting feedback summary, top sessions, vendor performance',
    to: (eventId) => `/events/${eventId}/dashboard`,
  },
  {
    id: 'b2b_feedback',
    title: '1:1 Meeting feedback',
    desc: 'View all vendor meeting ratings and comments',
    to: (eventId) => `/events/${eventId}/b2b-feedback`,
  },
  {
    id: 'session_feedback',
    title: 'Session feedback',
    desc: 'View all session ratings and comments',
    to: (eventId) => `/events/${eventId}/session-feedback`,
  },
  {
    id: 'photos',
    title: 'Photo book',
    desc: 'Browse feed photos for this event, open full size, and download',
    to: (eventId) => `/events/${eventId}/photos`,
  },
  {
    id: 'sponsors',
    title: 'Sponsors',
    desc: 'Tier labels, logos, and where they appear in the app (Info + hamburger menu)',
    to: (eventId) => `/events/${eventId}/sponsors`,
  },
  {
    id: 'matchmaking',
    title: 'Matchmaking',
    desc: 'Build delegate/vendor registration forms and collect responses',
    to: (eventId) => `/events/${eventId}/matchmaking`,
  },
  {
    id: 'badges',
    title: 'Badges',
    desc: 'Print 3.75″×5.5″ QR badges for all members — footer line, tokens, and layouts',
    to: (eventId) => `/events/${eventId}/badges`,
  },
  {
    id: 'scan_log',
    title: 'Notes log',
    desc: 'Badge-scan notes and context from the app: subject, scanner, kind, 1:1 meeting, notes, and timestamps',
    to: (eventId) => `/events/${eventId}/scan-log`,
  },
  {
    id: 'session_attendance',
    title: 'Session attendance',
    desc: 'Per-session badge check-in at the door — bookmarked vs checked in, print or export',
    to: (eventId) => `/events/${eventId}/session-attendance`,
  },
  {
    id: 'safety',
    title: 'Safety',
    desc: 'User reports and blocks between members of this event (from the app profile screen)',
    to: (eventId) => `/events/${eventId}/safety`,
  },
];

/** URL segment after /events/:eventId/ → tile id (edit and event root are not gated). */
export const EVENT_ADMIN_CONSOLE_PATH_SEGMENT_TO_TILE: Record<string, EventAdminConsoleTileId> = {
  members: 'members',
  schedule: 'schedule',
  'agenda-print': 'agenda_print',
  'vendor-booths': 'vendor_booths',
  meetings: 'meetings',
  announcements: 'announcements',
  dashboard: 'dashboard',
  'b2b-feedback': 'b2b_feedback',
  'session-feedback': 'session_feedback',
  photos: 'photos',
  sponsors: 'sponsors',
  matchmaking: 'matchmaking',
  badges: 'badges',
  'scan-log': 'scan_log',
  'session-attendance': 'session_attendance',
  safety: 'safety',
};

export function normalizeAdminConsoleTiles(raw: unknown): EventAdminConsoleTileId[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_EVENT_ADMIN_CONSOLE_TILES];
  }
  const out: EventAdminConsoleTileId[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && VALID_TILE_IDS.has(item)) {
      out.push(item as EventAdminConsoleTileId);
    }
  }
  const normalized = out.length > 0 ? out : [...DEFAULT_EVENT_ADMIN_CONSOLE_TILES];
  if (isLegacyDefaultWithoutAnnouncements(normalized)) {
    return [...DEFAULT_EVENT_ADMIN_CONSOLE_TILES];
  }
  return normalized;
}

/** Platform enabled session room check-in (web hub + mobile scan for event admins). */
export function isSessionAttendanceEnabled(tiles: string[] | null | undefined): boolean {
  return new Set(normalizeAdminConsoleTiles(tiles)).has('session_attendance');
}

/** Platform admins and event super_admins see every hub tile; event admins see `admin_console_tiles` only. */
export function isEventAdminConsoleTileVisible(
  tiles: string[] | null | undefined,
  tileId: EventAdminConsoleTileId,
  viewAllTiles: boolean
): boolean {
  if (viewAllTiles) return true;
  return new Set(normalizeAdminConsoleTiles(tiles)).has(tileId);
}
