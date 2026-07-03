import { supabase } from './supabase';
import type { VendorBooth } from './types';

export type BoothRepresentative = {
  user_id: string;
  full_name: string;
  title: string | null;
  company: string | null;
  avatar_url: string | null;
  isPrimary: boolean;
};

export type VendorBoothSummary = {
  booth_id: string;
  vendor_name: string;
  booth_location: string | null;
};

/** Booths where this user is primary contact or listed in vendor_booth_reps. */
export async function fetchVendorBoothsForUser(
  eventId: string,
  userId: string,
  client: typeof supabase = supabase
): Promise<VendorBoothSummary[]> {
  const [repRes, contactRes] = await Promise.all([
    client
      .from('vendor_booth_reps')
      .select('booth_id, vendor_booths!inner(id, vendor_name, booth_location, event_id, is_active)')
      .eq('user_id', userId)
      .eq('vendor_booths.event_id', eventId)
      .eq('vendor_booths.is_active', true),
    client
      .from('vendor_booths')
      .select('id, vendor_name, booth_location')
      .eq('event_id', eventId)
      .eq('contact_user_id', userId)
      .eq('is_active', true),
  ]);

  const byId = new Map<string, VendorBoothSummary>();
  for (const row of contactRes.data ?? []) {
    const b = row as { id: string; vendor_name: string; booth_location: string | null };
    byId.set(b.id, {
      booth_id: b.id,
      vendor_name: b.vendor_name,
      booth_location: b.booth_location,
    });
  }
  for (const row of repRes.data ?? []) {
    const vb = (row as {
      vendor_booths?: { id: string; vendor_name: string; booth_location: string | null } | { id: string; vendor_name: string; booth_location: string | null }[];
    }).vendor_booths;
    const booth = Array.isArray(vb) ? vb[0] : vb;
    if (!booth?.id) continue;
    byId.set(booth.id, {
      booth_id: booth.id,
      vendor_name: booth.vendor_name,
      booth_location: booth.booth_location ?? null,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.vendor_name.localeCompare(b.vendor_name, undefined, { sensitivity: 'base' })
  );
}

export async function fetchBoothRepresentatives(
  booth: Pick<VendorBooth, 'id' | 'contact_user_id'>,
  client: typeof supabase = supabase
): Promise<BoothRepresentative[]> {
  const { data: repRows, error: repErr } = await client
    .from('vendor_booth_reps')
    .select('user_id')
    .eq('booth_id', booth.id);
  if (repErr) throw repErr;

  const idSet = new Set<string>((repRows ?? []).map((r: { user_id: string }) => r.user_id));
  if (booth.contact_user_id) idSet.add(booth.contact_user_id);
  const ids = [...idSet];
  if (ids.length === 0) return [];

  const { data: usersData, error: usersErr } = await client
    .from('users')
    .select('id, full_name, title, company, avatar_url')
    .in('id', ids);
  if (usersErr) throw usersErr;

  const byId = new Map(
    (usersData ?? []).map(
      (u: {
        id: string;
        full_name: string | null;
        title: string | null;
        company: string | null;
        avatar_url: string | null;
      }) => [u.id, u]
    )
  );

  const reps: BoothRepresentative[] = ids.map((uid) => {
    const u = byId.get(uid);
    return {
      user_id: uid,
      full_name: u?.full_name?.trim() || 'Representative',
      title: u?.title?.trim() || null,
      company: u?.company?.trim() || null,
      avatar_url: u?.avatar_url ?? null,
      isPrimary: booth.contact_user_id === uid,
    };
  });

  reps.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' });
  });
  return reps;
}

/** Reps for all booths tied to a vendor user at an event (deduped by user_id). */
export async function fetchRepresentativesForVendorUser(
  eventId: string,
  userId: string,
  client: typeof supabase = supabase
): Promise<{ booths: VendorBoothSummary[]; representatives: BoothRepresentative[] }> {
  const booths = await fetchVendorBoothsForUser(eventId, userId, client);
  if (booths.length === 0) return { booths: [], representatives: [] };

  const boothIds = booths.map((b) => b.booth_id);
  const { data: boothRows } = await client
    .from('vendor_booths')
    .select('id, contact_user_id')
    .in('id', boothIds);

  const repByUser = new Map<string, BoothRepresentative>();
  for (const row of boothRows ?? []) {
    const booth = row as { id: string; contact_user_id: string | null };
    const reps = await fetchBoothRepresentatives(
      { id: booth.id, contact_user_id: booth.contact_user_id },
      client
    );
    for (const rep of reps) {
      if (!repByUser.has(rep.user_id)) repByUser.set(rep.user_id, rep);
    }
  }

  const representatives = [...repByUser.values()].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' });
  });
  return { booths, representatives };
}

function sortReps(reps: BoothRepresentative[]): BoothRepresentative[] {
  return [...reps].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' });
  });
}

function buildRepsForBooth(
  boothId: string,
  contactUserId: string | null | undefined,
  userIds: Set<string>,
  userById: Map<string, { full_name: string | null; title: string | null; company: string | null; avatar_url: string | null }>
): BoothRepresentative[] {
  const reps = [...userIds].map((uid) => {
    const u = userById.get(uid);
    return {
      user_id: uid,
      full_name: u?.full_name?.trim() || 'Representative',
      title: u?.title?.trim() || null,
      company: u?.company?.trim() || null,
      avatar_url: u?.avatar_url ?? null,
      isPrimary: contactUserId === uid,
    };
  });
  return sortReps(reps);
}

/** Batch-load representatives for many booths (1:1 list, schedule, etc.). */
export async function fetchRepresentativesByBoothIds(
  booths: Pick<VendorBooth, 'id' | 'contact_user_id'>[],
  client: typeof supabase = supabase
): Promise<Map<string, BoothRepresentative[]>> {
  const result = new Map<string, BoothRepresentative[]>();
  if (booths.length === 0) return result;

  const boothIds = booths.map((b) => b.id);
  const contactByBooth = new Map(booths.map((b) => [b.id, b.contact_user_id ?? null]));

  const { data: repRows, error: repErr } = await client
    .from('vendor_booth_reps')
    .select('booth_id, user_id')
    .in('booth_id', boothIds);
  if (repErr) throw repErr;

  const userIdsByBooth = new Map<string, Set<string>>();
  for (const boothId of boothIds) {
    const set = new Set<string>();
    const contact = contactByBooth.get(boothId);
    if (contact) set.add(contact);
    userIdsByBooth.set(boothId, set);
  }
  for (const row of repRows ?? []) {
    const r = row as { booth_id: string; user_id: string };
    userIdsByBooth.get(r.booth_id)?.add(r.user_id);
  }

  const allUserIds = [...new Set([...userIdsByBooth.values()].flatMap((s) => [...s]))];
  if (allUserIds.length === 0) {
    for (const boothId of boothIds) result.set(boothId, []);
    return result;
  }

  const { data: usersData, error: usersErr } = await client
    .from('users')
    .select('id, full_name, title, company, avatar_url')
    .in('id', allUserIds);
  if (usersErr) throw usersErr;

  const userById = new Map(
    (usersData ?? []).map(
      (u: {
        id: string;
        full_name: string | null;
        title: string | null;
        company: string | null;
        avatar_url: string | null;
      }) => [u.id, u]
    )
  );

  for (const boothId of boothIds) {
    const ids = userIdsByBooth.get(boothId) ?? new Set<string>();
    result.set(
      boothId,
      buildRepsForBooth(boothId, contactByBooth.get(boothId), ids, userById)
    );
  }
  return result;
}
