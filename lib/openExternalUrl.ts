import { Linking } from 'react-native';

/** Ensure Linking.openURL receives a valid http(s) URL (e.g. kbmcollective.org → https://…). */
export function normalizeExternalUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, '')}`;
}

export async function openExternalUrl(raw: string | null | undefined): Promise<boolean> {
  const href = normalizeExternalUrl(raw ?? '');
  if (!href) return false;
  try {
    // canOpenURL can return false for https on some iOS builds; still try openURL.
    const can = await Linking.canOpenURL(href).catch(() => true);
    if (!can) return false;
    await Linking.openURL(href);
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[openExternalUrl]', href, e);
    return false;
  }
}
