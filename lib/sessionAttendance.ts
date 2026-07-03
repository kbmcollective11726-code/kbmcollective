/** Matches admin_console_tiles key `session_attendance` (platform enables on Event admin tiles). */
export function isSessionAttendanceEnabled(adminConsoleTiles: string[] | null | undefined): boolean {
  if (!Array.isArray(adminConsoleTiles) || adminConsoleTiles.length === 0) return false;
  return adminConsoleTiles.includes('session_attendance');
}
