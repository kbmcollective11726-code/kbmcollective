import { isSessionAttendanceEnabled } from './sessionAttendance';
import type { Event } from './types';

function isSessionCheckInMenuOn(event: Event): boolean {
  if (event.platform_menu_show_session_check_in !== true) return false;
  return event.menu_show_session_check_in !== false;
}

/** Session check-in in hamburger: admins only; event admins also need hub tile enabled. */
export function canShowSessionCheckInMenu(
  event: Event | null | undefined,
  opts: { isPlatformAdmin: boolean; isEventAdmin: boolean }
): boolean {
  if (!event?.id) return false;
  if (!opts.isPlatformAdmin && !opts.isEventAdmin) return false;
  if (!isSessionCheckInMenuOn(event)) return false;
  if (opts.isPlatformAdmin) return true;
  return isSessionAttendanceEnabled(event.admin_console_tiles);
}
