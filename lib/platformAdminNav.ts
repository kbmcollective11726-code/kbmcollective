/** Landing screen for platform admins after sign-in. */
export const PLATFORM_ADMIN_ALL_EVENTS_HREF = '/(tabs)/profile/admin-all-events' as const;

export function isPlatformAdminAllEventsPath(pathname: string | undefined): boolean {
  return !!pathname && pathname.includes('admin-all-events');
}

/** One-shot: after login/session restore, tabs must open All events even if an event is already selected. */
let pendingAllEventsLanding = false;

export function markPlatformAdminAllEventsLanding(): void {
  pendingAllEventsLanding = true;
}

export function peekPlatformAdminAllEventsLanding(): boolean {
  return pendingAllEventsLanding;
}

export function consumePlatformAdminAllEventsLanding(): boolean {
  const pending = pendingAllEventsLanding;
  pendingAllEventsLanding = false;
  return pending;
}
