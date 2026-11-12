import {
  EVENT_ADMIN_CONSOLE_TILES,
  normalizeAdminConsoleTiles,
  type EventAdminConsoleTileId,
} from './eventAdminTiles';
import type { Event } from './types';
import type { MenuShowKey, PlatformHamburgerTabKey, PlatformMenuKey } from './effectiveEventMenu';

export type { MenuShowKey, PlatformHamburgerTabKey, PlatformMenuKey };
export type MenuShowDraft = Record<MenuShowKey, boolean>;
export type PlatformMenuDraft = Record<PlatformMenuKey, boolean>;
export type PlatformHamburgerDraft = Record<PlatformHamburgerTabKey, boolean>;

export interface HamburgerTabShortcutDef {
  id: string;
  title: string;
  desc: string;
  key: PlatformHamburgerTabKey;
}

/** Platform-only: duplicate bottom tabs in the side menu (off by default). */
export const HAMBURGER_TAB_SHORTCUTS: HamburgerTabShortcutDef[] = [
  {
    id: 'hamburger_info',
    title: 'Info',
    desc: 'Also list Info in the hamburger (bottom tab stays).',
    key: 'platform_hamburger_show_info',
  },
  {
    id: 'hamburger_feed',
    title: 'Feed',
    desc: 'Also list Feed in the hamburger (bottom tab stays).',
    key: 'platform_hamburger_show_feed',
  },
  {
    id: 'hamburger_agenda',
    title: 'Agenda',
    desc: 'Also list Agenda in the hamburger when event admins have Agenda visible.',
    key: 'platform_hamburger_show_agenda',
  },
  {
    id: 'hamburger_community',
    title: 'Community',
    desc: 'Also list Community in the hamburger (bottom tab stays).',
    key: 'platform_hamburger_show_community',
  },
  {
    id: 'hamburger_rank',
    title: 'Rank',
    desc: 'Also list Rank in the hamburger (bottom tab stays).',
    key: 'platform_hamburger_show_rank',
  },
];

export const DEFAULT_PLATFORM_HAMBURGER: PlatformHamburgerDraft = {
  platform_hamburger_show_info: false,
  platform_hamburger_show_feed: false,
  platform_hamburger_show_agenda: false,
  platform_hamburger_show_community: false,
  platform_hamburger_show_rank: false,
};

export function platformHamburgerFromEvent(e: Event): PlatformHamburgerDraft {
  return {
    platform_hamburger_show_info: e.platform_hamburger_show_info === true,
    platform_hamburger_show_feed: e.platform_hamburger_show_feed === true,
    platform_hamburger_show_agenda: e.platform_hamburger_show_agenda === true,
    platform_hamburger_show_community: e.platform_hamburger_show_community === true,
    platform_hamburger_show_rank: e.platform_hamburger_show_rank === true,
  };
}

export function hamburgerShortcutDraftFromEvent(e: Event): Record<string, boolean> {
  const flags = platformHamburgerFromEvent(e);
  const draft: Record<string, boolean> = {};
  for (const item of HAMBURGER_TAB_SHORTCUTS) {
    draft[item.id] = flags[item.key];
  }
  return draft;
}

export function buildHamburgerShortcutSavePayload(draft: Record<string, boolean>): PlatformHamburgerDraft {
  const out: PlatformHamburgerDraft = { ...DEFAULT_PLATFORM_HAMBURGER };
  for (const item of HAMBURGER_TAB_SHORTCUTS) {
    out[item.key] = draft[item.id] === true;
  }
  return out;
}

export interface ExperienceControlDef {
  id: string;
  title: string;
  desc: string;
  tags: ('Web admin' | 'App menu')[];
  hubTileIds?: EventAdminConsoleTileId[];
  menuKeys?: MenuShowKey[];
  platformMenuKeys?: PlatformMenuKey[];
}

/** Platform admin: which features exist for this event (web hub + app ceiling). */
export const EVENT_EXPERIENCE_CONTROLS: ExperienceControlDef[] = [
  {
    id: 'members',
    title: 'Members',
    desc: 'View members or add from CSV (batch)',
    tags: ['Web admin'],
    hubTileIds: ['members'],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    desc: 'Add sessions or import from CSV (batch)',
    tags: ['Web admin'],
    hubTileIds: ['schedule'],
  },
  {
    id: 'agenda_print',
    title: 'Printable agenda',
    desc: 'At-a-glance program layout for PDF or paper',
    tags: ['Web admin'],
    hubTileIds: ['agenda_print'],
  },
  {
    id: 'agenda_app',
    title: 'Agenda',
    desc: 'Event admins can show or hide Agenda in the app (tab + side menu)',
    tags: ['App menu'],
    menuKeys: ['menu_show_agenda'],
    platformMenuKeys: ['platform_menu_show_agenda'],
  },
  {
    id: 'announcements',
    title: 'Announcements',
    desc: 'Send announcements and push notifications to event members',
    tags: ['Web admin'],
    hubTileIds: ['announcements'],
  },
  {
    id: 'photos',
    title: 'Photo book',
    desc: 'Browse feed photos for this event, open full size, and download',
    tags: ['Web admin'],
    hubTileIds: ['photos'],
  },
  {
    id: 'solution_providers',
    title: 'Solution Providers',
    desc: 'Web admin booths; event admins control in-app list visibility',
    tags: ['Web admin', 'App menu'],
    hubTileIds: ['vendor_booths'],
    menuKeys: ['menu_show_solution_providers'],
    platformMenuKeys: ['platform_menu_show_solution_providers'],
  },
  {
    id: 'meetings',
    title: '1:1 Meetings',
    desc: 'Assign meetings in web admin; event admins control in-app menu',
    tags: ['Web admin', 'App menu'],
    hubTileIds: ['meetings'],
    menuKeys: ['menu_show_1on1'],
    platformMenuKeys: ['platform_menu_show_1on1'],
  },
  {
    id: 'scan_badge',
    title: 'Scan badge',
    desc: 'Web notes log; only platform admins can show Scan badge in the app menu (off by default)',
    tags: ['Web admin', 'App menu'],
    hubTileIds: ['scan_log'],
    menuKeys: ['menu_show_scan_badge'],
    platformMenuKeys: ['platform_menu_show_scan_badge'],
  },
  {
    id: 'notes',
    title: 'Notes in the menu',
    desc: 'Notes list in the app side menu for event admins and vendor reps (platform only)',
    tags: ['App menu'],
    menuKeys: ['menu_show_notes'],
    platformMenuKeys: ['platform_menu_show_notes'],
  },
  {
    id: 'scan_notes',
    title: 'Notes on badge scans and 1:1 meetings',
    desc: 'Notes box when a vendor scans a badge and Add notes on the 1:1 Meetings page (platform only, on by default)',
    tags: ['App menu'],
    menuKeys: ['menu_show_scan_notes'],
    platformMenuKeys: ['platform_menu_show_scan_notes'],
  },
  {
    id: 'live_wall',
    title: 'Live wall',
    desc: 'Event admins can show or hide Live wall in the app',
    tags: ['App menu'],
    menuKeys: ['menu_show_live_wall'],
    platformMenuKeys: ['platform_menu_show_live_wall'],
  },
  {
    id: 'dashboard',
    title: 'Member dashboard',
    desc: 'Session & 1:1 feedback summary, top sessions, vendor performance',
    tags: ['Web admin'],
    hubTileIds: ['dashboard'],
  },
  {
    id: 'b2b_feedback',
    title: '1:1 Meeting feedback',
    desc: 'View all vendor meeting ratings and comments',
    tags: ['Web admin'],
    hubTileIds: ['b2b_feedback'],
  },
  {
    id: 'session_feedback',
    title: 'Session feedback',
    desc: 'View all session ratings and comments',
    tags: ['Web admin'],
    hubTileIds: ['session_feedback'],
  },
  {
    id: 'sponsors',
    title: 'Sponsors',
    desc: 'Tier labels, logos, and in-app placement',
    tags: ['Web admin'],
    hubTileIds: ['sponsors'],
  },
  {
    id: 'matchmaking',
    title: 'Matchmaking',
    desc: 'Delegate/vendor registration, meeting requests, and scheduling. Turns off Standard registration',
    tags: ['Web admin'],
    hubTileIds: ['matchmaking'],
  },
  {
    id: 'standard_registration',
    title: 'Standard registration',
    desc: 'Public event website (info, agenda, FAQ) and simple registration. Turns off Matchmaking — an event uses one or the other',
    tags: ['Web admin'],
    hubTileIds: ['standard_registration'],
  },
  {
    id: 'badges',
    title: 'Badges',
    desc: 'Print QR badges for members',
    tags: ['Web admin'],
    hubTileIds: ['badges'],
  },
  {
    id: 'session_attendance',
    title: 'Session attendance',
    desc: 'Web reports + room check-in in app hamburger (event admins need hub tile and menu on)',
    tags: ['Web admin', 'App menu'],
    hubTileIds: ['session_attendance'],
    menuKeys: ['menu_show_session_check_in'],
    platformMenuKeys: ['platform_menu_show_session_check_in'],
  },
  {
    id: 'safety',
    title: 'Safety',
    desc: 'User reports and blocks for this event',
    tags: ['Web admin'],
    hubTileIds: ['safety'],
  },
];

export interface ExperienceControlGroup {
  id: string;
  title: string;
  desc: string;
  controlIds: string[];
}

/** Card layout on Event admin tiles. Controls not listed here fall into "Other". */
export const EXPERIENCE_CONTROL_GROUPS: ExperienceControlGroup[] = [
  {
    id: 'program',
    title: 'Program & attendees',
    desc: 'Members, agenda, announcements, and session check-in',
    controlIds: [
      'members',
      'schedule',
      'agenda_print',
      'agenda_app',
      'announcements',
      'standard_registration',
      'session_attendance',
    ],
  },
  {
    id: 'vendors',
    title: 'Vendors & 1:1 meetings',
    desc: 'Solution providers, meeting scheduling, matchmaking, and meeting ratings',
    controlIds: ['solution_providers', 'meetings', 'matchmaking', 'b2b_feedback'],
  },
  {
    id: 'badges',
    title: 'Badges, scanning & notes',
    desc: 'Printed badges, badge scanning in the app, and vendor notes',
    controlIds: ['badges', 'scan_badge', 'notes', 'scan_notes'],
  },
  {
    id: 'engagement',
    title: 'Engagement',
    desc: 'Photos, the live wall, and sponsor placement',
    controlIds: ['photos', 'live_wall', 'sponsors'],
  },
  {
    id: 'reports',
    title: 'Reports & safety',
    desc: 'Dashboards, session ratings, and user reports',
    controlIds: ['dashboard', 'session_feedback', 'safety'],
  },
];

/** Event admins may toggle these in the app when platform allowed them. */
export const EVENT_ADMIN_APP_MENU_TOGGLES: {
  id: string;
  title: string;
  desc: string;
  menuKey: MenuShowKey;
  platformKey: PlatformMenuKey;
}[] = [
  {
    id: 'agenda_app',
    title: 'Agenda',
    desc: 'Agenda tab and side menu link in the mobile app',
    menuKey: 'menu_show_agenda',
    platformKey: 'platform_menu_show_agenda',
  },
  {
    id: 'solution_providers',
    title: 'Solution Providers',
    desc: 'Solution Providers list in the mobile app',
    menuKey: 'menu_show_solution_providers',
    platformKey: 'platform_menu_show_solution_providers',
  },
  {
    id: 'meetings',
    title: '1:1 Meetings',
    desc: '1:1 Meetings link in the mobile app',
    menuKey: 'menu_show_1on1',
    platformKey: 'platform_menu_show_1on1',
  },
  {
    id: 'live_wall',
    title: 'Live wall',
    desc: 'Live wall link in the mobile app',
    menuKey: 'menu_show_live_wall',
    platformKey: 'platform_menu_show_live_wall',
  },
  {
    id: 'session_attendance',
    title: 'Session check-in',
    desc: 'Session room badge scan in the hamburger menu',
    menuKey: 'menu_show_session_check_in',
    platformKey: 'platform_menu_show_session_check_in',
  },
];

const HUB_ORDER = EVENT_ADMIN_CONSOLE_TILES.map((t) => t.id);

export const DEFAULT_MENU_SHOW: MenuShowDraft = {
  menu_show_agenda: true,
  menu_show_1on1: false,
  menu_show_scan_badge: false,
  menu_show_notes: false,
  menu_show_scan_notes: true,
  menu_show_live_wall: false,
  menu_show_solution_providers: false,
  menu_show_session_check_in: false,
};

export const DEFAULT_PLATFORM_MENU: PlatformMenuDraft = {
  platform_menu_show_agenda: false,
  platform_menu_show_1on1: false,
  platform_menu_show_scan_badge: false,
  platform_menu_show_notes: false,
  platform_menu_show_scan_notes: true,
  platform_menu_show_live_wall: false,
  platform_menu_show_solution_providers: false,
  platform_menu_show_session_check_in: false,
};

export function menuShowFromEvent(e: Event): MenuShowDraft {
  return {
    menu_show_agenda: e.menu_show_agenda !== false,
    menu_show_1on1: e.menu_show_1on1 !== false,
    menu_show_scan_badge: e.menu_show_scan_badge !== false,
    menu_show_notes: e.menu_show_notes !== false,
    menu_show_scan_notes: e.menu_show_scan_notes !== false,
    menu_show_live_wall: e.menu_show_live_wall !== false,
    menu_show_solution_providers: e.menu_show_solution_providers !== false,
    menu_show_session_check_in: e.menu_show_session_check_in !== false,
  };
}

export function platformMenuFromEvent(e: Event): PlatformMenuDraft {
  return {
    platform_menu_show_agenda: e.platform_menu_show_agenda === true,
    platform_menu_show_1on1: e.platform_menu_show_1on1 === true,
    platform_menu_show_scan_badge: e.platform_menu_show_scan_badge === true,
    platform_menu_show_notes: e.platform_menu_show_notes === true,
    platform_menu_show_scan_notes: e.platform_menu_show_scan_notes !== false,
    platform_menu_show_live_wall: e.platform_menu_show_live_wall === true,
    platform_menu_show_solution_providers: e.platform_menu_show_solution_providers === true,
    platform_menu_show_session_check_in: e.platform_menu_show_session_check_in === true,
  };
}

function hubTilesSatisfied(tileIds: EventAdminConsoleTileId[] | undefined, tiles: Set<EventAdminConsoleTileId>): boolean {
  if (!tileIds?.length) return true;
  return tileIds.every((id) => tiles.has(id));
}

function platformMenuSatisfied(keys: PlatformMenuKey[] | undefined, platform: PlatformMenuDraft): boolean {
  if (!keys?.length) return true;
  return keys.every((k) => platform[k]);
}

export function isPlatformControlEnabled(
  control: ExperienceControlDef,
  tiles: Set<EventAdminConsoleTileId>,
  platform: PlatformMenuDraft
): boolean {
  return hubTilesSatisfied(control.hubTileIds, tiles) && platformMenuSatisfied(control.platformMenuKeys, platform);
}

export function platformExperienceDraftFromEvent(e: Event): Record<string, boolean> {
  const tiles = new Set(normalizeAdminConsoleTiles(e.admin_console_tiles));
  const platform = platformMenuFromEvent(e);
  const draft: Record<string, boolean> = {};
  for (const c of EVENT_EXPERIENCE_CONTROLS) {
    draft[c.id] = isPlatformControlEnabled(c, tiles, platform);
  }
  return draft;
}

export function buildPlatformSavePayload(draft: Record<string, boolean>): {
  admin_console_tiles: EventAdminConsoleTileId[];
  platform: PlatformMenuDraft;
  menu: MenuShowDraft;
} {
  const tileSet = new Set<EventAdminConsoleTileId>();
  const platform: PlatformMenuDraft = { ...DEFAULT_PLATFORM_MENU };
  const menu: MenuShowDraft = { ...DEFAULT_MENU_SHOW };

  for (const c of EVENT_EXPERIENCE_CONTROLS) {
    const on = draft[c.id] === true;
    if (on) {
      for (const id of c.hubTileIds ?? []) tileSet.add(id);
      for (const key of c.platformMenuKeys ?? []) platform[key] = true;
      for (const key of c.menuKeys ?? []) menu[key] = true;
    } else {
      for (const key of c.platformMenuKeys ?? []) platform[key] = false;
      for (const key of c.menuKeys ?? []) menu[key] = false;
    }
  }

  const admin_console_tiles = HUB_ORDER.filter((id) => tileSet.has(id));
  return { admin_console_tiles, platform, menu };
}

export function eventAdminMenuDraftFromEvent(e: Event): Record<string, boolean> {
  const menu = menuShowFromEvent(e);
  const draft: Record<string, boolean> = {};
  for (const t of EVENT_ADMIN_APP_MENU_TOGGLES) {
    draft[t.id] = menu[t.menuKey];
  }
  return draft;
}

export function buildEventAdminMenuSavePayload(draft: Record<string, boolean>): Partial<MenuShowDraft> {
  const menu: Partial<MenuShowDraft> = {};
  for (const t of EVENT_ADMIN_APP_MENU_TOGGLES) {
    menu[t.menuKey] = draft[t.id] === true;
  }
  return menu;
}

export function countEventAdminMenuOptionsAllowed(e: Event): number {
  const platform = platformMenuFromEvent(e);
  return EVENT_ADMIN_APP_MENU_TOGGLES.filter((t) => platform[t.platformKey]).length;
}

/** Keys on EventFormFields for each event-admin app menu toggle. */
export const EVENT_ADMIN_MENU_FORM_FIELD: Record<
  string,
  | 'menuShowAgenda'
  | 'menuShowSolutionProviders'
  | 'menuShow1on1'
  | 'menuShowLiveWall'
  | 'menuShowSessionCheckIn'
> = {
  agenda_app: 'menuShowAgenda',
  solution_providers: 'menuShowSolutionProviders',
  meetings: 'menuShow1on1',
  live_wall: 'menuShowLiveWall',
  session_attendance: 'menuShowSessionCheckIn',
};

/** menu_show_* columns to include on Edit event save (platform-allowed only). */
export function eventAdminMenuUpdateFromForm(
  form: {
    menuShowAgenda: boolean;
    menuShowSolutionProviders: boolean;
    menuShow1on1: boolean;
    menuShowLiveWall: boolean;
    menuShowSessionCheckIn: boolean;
  },
  platform: PlatformMenuDraft
): Partial<MenuShowDraft> {
  const menu: Partial<MenuShowDraft> = {};
  for (const t of EVENT_ADMIN_APP_MENU_TOGGLES) {
    if (!platform[t.platformKey]) continue;
    const field = EVENT_ADMIN_MENU_FORM_FIELD[t.id];
    if (!field) continue;
    menu[t.menuKey] = form[field];
  }
  return menu;
}
