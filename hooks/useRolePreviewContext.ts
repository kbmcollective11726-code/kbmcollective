import { useAuthStore } from '../stores/authStore';
import { useRolePreviewStore } from '../stores/rolePreviewStore';
import {
  effectiveIsEventAdmin,
  effectiveIsVendorRep,
  effectivePlatformBypass,
  effectiveScannerKind,
  isPreviewActive,
  type RolePreviewKind,
} from '../lib/rolePreview';

export function useRolePreviewContext() {
  const user = useAuthStore((s) => s.user);
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const isPlatformAdmin = user?.is_platform_admin === true;

  return {
    previewRole,
    isPlatformAdmin,
    isPreviewing: isPlatformAdmin && isPreviewActive(previewRole),
    showPlatformAdminTools: isPlatformAdmin && previewRole === 'off',
    applyEventAdmin: (realIsEventAdmin: boolean) =>
      effectiveIsEventAdmin(realIsEventAdmin, isPlatformAdmin, previewRole),
    applyVendorRep: (realIsVendorRep: boolean) =>
      effectiveIsVendorRep(realIsVendorRep, isPlatformAdmin, previewRole),
    applyPlatformBypass: () => effectivePlatformBypass(isPlatformAdmin, previewRole),
    applyScannerKind: (serverKind?: string) =>
      effectiveScannerKind(serverKind, isPlatformAdmin, previewRole),
    withPreview: (role: RolePreviewKind) => {
      if (!isPlatformAdmin) return role === 'off';
      return previewRole === role;
    },
  };
}
