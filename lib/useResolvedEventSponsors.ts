import { useCallback, useEffect, useMemo, useState } from 'react';
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

/**
 * Loads event sponsors (with scheduled creatives) and resolves the active logo for the event timezone.
 * Re-resolves on a timer so scheduled swaps happen without a manual refresh.
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
  const [rows, setRows] = useState<SponsorWithCreatives[]>([]);
  const [scheduleTick, setScheduleTick] = useState(0);

  const load = useCallback(async () => {
    if (!eventId || !enabled) {
      setRows([]);
      return;
    }
    const { data, error } = await supabase
      .from('event_sponsors')
      .select(EVENT_SPONSORS_WITH_CREATIVES_SELECT)
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      setRows([]);
      return;
    }
    setRows((data as SponsorWithCreatives[]) ?? []);
  }, [eventId, enabled]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

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

  return { sponsors, reload: load };
}
