/** Deployed admin SPA (vendor booths CSV, assign 1:1 meetings, etc.). Override for local dev via .env. */
const DEFAULT_ADMIN_CONSOLE_BASE = 'https://cadmin.kbmcollective.org';

export function getAdminConsoleBaseUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_ADMIN_CONSOLE_URL
      ? String(process.env.EXPO_PUBLIC_ADMIN_CONSOLE_URL).trim().replace(/\/+$/, '')
      : '';
  return fromEnv || DEFAULT_ADMIN_CONSOLE_BASE;
}

/** Web route where organizers bulk-assign booth meetings (same as admin-setup BulkB2BAssign). */
export function adminConsoleMeetingsUrl(eventId: string): string {
  return `${getAdminConsoleBaseUrl()}/events/${encodeURIComponent(eventId)}/meetings`;
}
