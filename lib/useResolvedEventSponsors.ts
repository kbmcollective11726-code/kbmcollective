import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applyScheduledSponsorLogos,
  EVENT_SPONSORS_WITH_CREATIVES_SELECT,
  sponsorMatchesPlacement,
  type SponsorPlacement,
  type SponsorWithCreatives,
} from './sponsorCreatives';
import { supabase } from './supabase';
import type { EventSponsor } from './types';

type Options = {
  enabled?: boolean;
  pollMs?: number;
  refreshKey?: unknown;
};

const memoryRowsByEvent = new Map<string, SponsorWithCreatives[]>();

function storageKey(eventId: string): string {
  return `collectivelive_sponsors_v1_${eventId}`;
}

async function loadCachedSponsorRows(eventId: string): Promise<SponsorWithCreatives[] | null> {
  const mem = memoryRowsByEvent.get(eventId);
  if (mem) return mem;
  try {
    const raw = await AsyncStorage.getItem(storageKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: SponsorWithCreatives[] };
    if (!Array.isArray(parsed.rows)) return null;
    memoryRowsByEvent.set(eventId, parsed.rows);
    return parsed.rows;
  } catch {
    return null;
  }
}

async function saveCachedSponsorRows(eventId: string, rows: SponsorWithCreatives[]): Promise<void> {
  memoryRowsByEvent.set(eventId, rows);
  try {
    await AsyncStorage.setItem(storageKey(eventId), JSON.stringify({ savedAt: Date.now(), rows }));
  } catch {
    // ignore
  }
}

/**
 * Loads event sponsors (with scheduled creatives) and resolves the active logo for the event timezone.
 * Re-resolves on a timer so scheduled swaps happen without a manual refresh.
 * Uses memory + AsyncStorage so Feed/Schedule don't blip when the strip arrives after posts.
 */
export function useResolvedEventSponsors(
  eventId: string | undefined,
  placement: SponsorPlacement,
  eventTimezone?: string | null,
  options?: Options
) {
  const enabled = options?.enabled ?? true;
  const pollMs = options?.pollMs ?? 60_000;
  const refreshKey = options?.refreshKey;
  const [rows, setRows] = useState<SponsorWithCreatives[]>(() =>
    eventId && enabled ? memoryRowsByEvent.get(eventId) ?? [] : []
  );
  const [loading, setLoading] = useState(() => {
    if (!eventId || !enabled) return false;
    return !memoryRowsByEvent.has(eventId);
  });
  const [scheduleTick, setScheduleTick] = useState(0);

  const load = useCallback(async () => {
    if (!eventId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('event_sponsors')
      .select(EVENT_SPONSORS_WITH_CREATIVES_SELECT)
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      setLoading(false);
      return;
    }
    const next = (data as SponsorWithCreatives[]) ?? [];
    setRows(next);
    void saveCachedSponsorRows(eventId, next);
    setLoading(false);
  }, [eventId, enabled]);

  useEffect(() => {
    if (!eventId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const mem = memoryRowsByEvent.get(eventId);
    if (mem) {
      setRows(mem);
      setLoading(false);
    } else {
      setLoading(true);
      void loadCachedSponsorRows(eventId).then((cached) => {
        if (cancelled || !cached) return;
        setRows(cached);
        setLoading(false);
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled, load, refreshKey]);

  useEffect(() => {
    if (!eventId || !enabled) return;
    const id = setInterval(() => setScheduleTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [eventId, enabled, pollMs]);

  const sponsors = useMemo((): EventSponsor[] => {
    const filtered = rows.filter((s) => sponsorMatchesPlacement(s, placement));
    return applyScheduledSponsorLogos(filtered, eventTimezone, new Date());
    // scheduleTick forces re-resolution when the wall-clock window changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, placement, eventTimezone, scheduleTick]);

  return { sponsors, loading, reload: load };
}
