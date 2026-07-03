import { canShowSessionCheckInMenu } from './sessionCheckInMenu';
import type { Event } from './types';

/** Platform admin UI preview — does not change server-side roles or RLS. */
export type RolePreviewKind = 'off' | 'attendee' | 'speaker' | 'vendor' | 'admin';

export const ROLE_PREVIEW_OPTIONS: { id: RolePreviewKind; label: string; hint: string }[] = [
  { id: 'off', label: 'Platform admin (normal)', hint: 'Your real permissions' },
  { id: 'attendee', label: 'Attendee', hint: 'Standard participant menus' },
  { id: 'speaker', label: 'Speaker', hint: 'Same as attendee for most screens' },
  { id: 'vendor', label: 'Vendor / booth rep', hint: 'Vendor-style expo & notes' },
  { id: 'admin', label: 'Event admin', hint: 'In-app event management' },
];

export function isPreviewActive(preview: RolePreviewKind): boolean {
  return preview !== 'off';
}

export function previewRoleLabel(preview: RolePreviewKind): string {
  return ROLE_PREVIEW_OPTIONS.find((o) => o.id === preview)?.label ?? preview;
}

/** Platform-admin bypass for event features — disabled while previewing another role. */
export function effectivePlatformBypass(isPlatformAdmin: boolean, preview: RolePreviewKind): boolean {
  if (!isPlatformAdmin) return false;
  return preview === 'off';
}

export function effectiveIsEventAdmin(
  realIsEventAdmin: boolean,
  isPlatformAdmin: boolean,
  preview: RolePreviewKind
): boolean {
  if (isPlatformAdmin && preview !== 'off') return preview === 'admin';
  return realIsEventAdmin || isPlatformAdmin;
}

export function effectiveIsVendorRep(
  realIsVendorRep: boolean,
  isPlatformAdmin: boolean,
  preview: RolePreviewKind
): boolean {
  if (isPlatformAdmin && preview !== 'off') return preview === 'vendor';
  return realIsVendorRep;
}

export function effectiveMyRoles(
  realRoles: string[],
  isPlatformAdmin: boolean,
  preview: RolePreviewKind
): string[] {
  if (!isPlatformAdmin || preview === 'off') return realRoles;
  if (preview === 'attendee') return ['attendee'];
  if (preview === 'speaker') return ['speaker'];
  if (preview === 'vendor') return ['vendor'];
  if (preview === 'admin') return ['admin'];
  return realRoles;
}

export function effectiveScannerKind(
  serverKind: string | undefined,
  isPlatformAdmin: boolean,
  preview: RolePreviewKind
): string | undefined {
  if (!isPlatformAdmin || preview === 'off') return serverKind;
  if (preview === 'admin') return 'admin';
  if (preview === 'speaker') return 'speaker';
  if (preview === 'vendor') return 'vendor';
  return 'attendee';
}

export function effectiveCanShowSessionCheckIn(
  event: Event | null | undefined,
  realIsEventAdmin: boolean,
  isPlatformAdmin: boolean,
  preview: RolePreviewKind
): boolean {
  const effPlatform = effectivePlatformBypass(isPlatformAdmin, preview);
  const effEventAdmin = effectiveIsEventAdmin(realIsEventAdmin, isPlatformAdmin, preview);
  return canShowSessionCheckInMenu(event, { isPlatformAdmin: effPlatform, isEventAdmin: effEventAdmin });
}
