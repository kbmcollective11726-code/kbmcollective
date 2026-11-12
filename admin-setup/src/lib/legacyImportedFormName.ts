/**
 * Detect leftover imported registration form titles so we can rename them
 * to KBM Legacy … and keep the admin UI KBM-branded only.
 */
export function isLegacyImportedFormName(name: string): boolean {
  return /meet\s*max/i.test(name);
}
