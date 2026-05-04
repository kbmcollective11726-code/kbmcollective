/**
 * Sponsor `logo_url` values are often absolute HTTPS URLs (R2, Supabase Storage).
 * Normalize so the live wall (always served over HTTPS) does not block mixed content
 * or resolve protocol-relative URLs incorrectly.
 */
export function normalizeLiveWallSponsorImageUrl(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (t.startsWith('//')) return `https:${t}`;
  if (t.startsWith('http://')) return `https://${t.slice(7)}`;
  return t;
}
