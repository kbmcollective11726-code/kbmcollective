import type { Event } from './types';

export type MenuShowKey =
  | 'menu_show_agenda'
  | 'menu_show_1on1'
  | 'menu_show_scan_badge'
  | 'menu_show_notes'
  | 'menu_show_scan_notes'
  | 'menu_show_live_wall'
  | 'menu_show_solution_providers'
  | 'menu_show_session_check_in';

export type PlatformMenuKey =
  | 'platform_menu_show_agenda'
  | 'platform_menu_show_1on1'
  | 'platform_menu_show_scan_badge'
  | 'platform_menu_show_notes'
  | 'platform_menu_show_scan_notes'
  | 'platform_menu_show_live_wall'
  | 'platform_menu_show_solution_providers'
  | 'platform_menu_show_session_check_in';

export type PlatformHamburgerTabKey =
  | 'platform_hamburger_show_info'
  | 'platform_hamburger_show_feed'
  | 'platform_hamburger_show_agenda'
  | 'platform_hamburger_show_community'
  | 'platform_hamburger_show_rank';

export const MENU_TO_PLATFORM: Record<MenuShowKey, PlatformMenuKey> = {
  menu_show_agenda: 'platform_menu_show_agenda',
  menu_show_1on1: 'platform_menu_show_1on1',
  menu_show_scan_badge: 'platform_menu_show_scan_badge',
  menu_show_notes: 'platform_menu_show_notes',
  menu_show_scan_notes: 'platform_menu_show_scan_notes',
  menu_show_live_wall: 'platform_menu_show_live_wall',
  menu_show_solution_providers: 'platform_menu_show_solution_providers',
  menu_show_session_check_in: 'platform_menu_show_session_check_in',
};

/** Shown in the mobile app when platform allowed and event admin left the item on. */
export function isAppMenuItemVisible(event: Event | null | undefined, menuKey: MenuShowKey): boolean {
  if (!event) return false;
  const platformKey = MENU_TO_PLATFORM[menuKey];
  // Opt-in platform ceiling (false/undefined = hidden).
  if (event[platformKey] !== true) return false;
  return event[menuKey] !== false;
}

/** Vendor notes on badge scans and 1:1 Meetings. Missing columns (older rows) count as on. */
export function areVendorScanNotesOn(event: Event | null | undefined): boolean {
  if (!event) return true;
  return event.platform_menu_show_scan_notes !== false && event.menu_show_scan_notes !== false;
}

/**
 * Bottom-tab duplicates in the hamburger (Info / Feed / Agenda / Community / Rank).
 * Off by default; platform admin opts in per event.
 * Agenda also requires the existing event-admin Agenda visibility gate.
 */
export function isHamburgerTabShortcutVisible(
  event: Event | null | undefined,
  key: PlatformHamburgerTabKey,
): boolean {
  if (!event) return false;
  if (event[key] !== true) return false;
  if (key === 'platform_hamburger_show_agenda') {
    return isAppMenuItemVisible(event, 'menu_show_agenda');
  }
  return true;
}
