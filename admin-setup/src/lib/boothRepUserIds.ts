import { supabase } from './supabase';

/** Primary contact + vendor_booth_reps for a booth (deduped). */
export async function fetchBoothRepUserIds(boothId: string): Promise<string[]> {
  const [{ data: booth }, { data: reps, error: repErr }] = await Promise.all([
    supabase.from('vendor_booths').select('contact_user_id').eq('id', boothId).maybeSingle(),
    supabase.from('vendor_booth_reps').select('user_id').eq('booth_id', boothId),
  ]);
  if (repErr) throw repErr;

  const ids = new Set<string>();
  const contact = (booth as { contact_user_id?: string | null } | null)?.contact_user_id;
  if (contact) ids.add(contact);
  for (const row of reps ?? []) {
    const uid = (row as { user_id: string }).user_id;
    if (uid) ids.add(uid);
  }
  return [...ids];
}
