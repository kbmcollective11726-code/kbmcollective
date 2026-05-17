import { isCurrentUserPlatformAdmin } from './fetchAdminEvents';

/** Only KBM platform operators may change which hub tiles event admins see (matches DB trigger). */
export async function canManageEventAdminConsoleTiles(): Promise<boolean> {
  return isCurrentUserPlatformAdmin();
}
