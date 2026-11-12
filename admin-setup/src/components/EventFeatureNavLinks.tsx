import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { canSuperAdminDeleteEvent } from '../lib/canSuperAdminDeleteEvent';
import {
  isEventAdminConsoleTileVisible,
  normalizeAdminConsoleTiles,
  type EventAdminConsoleTileId,
} from '../lib/eventAdminTiles';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { supabase } from '../lib/supabase';
import styles from './EventFeatureNavLinks.module.css';

type FeatureId = 'vendor_booths' | 'meetings' | 'matchmaking';

const FEATURES: Array<{
  id: FeatureId;
  tileId: EventAdminConsoleTileId;
  label: string;
  path: (eventId: string) => string;
}> = [
  {
    id: 'vendor_booths',
    tileId: 'vendor_booths',
    label: 'Solution Providers',
    path: (eventId) => `/events/${eventId}/vendor-booths`,
  },
  {
    id: 'meetings',
    tileId: 'meetings',
    label: 'Meetings',
    path: (eventId) => `/events/${eventId}/meetings`,
  },
  {
    id: 'matchmaking',
    tileId: 'matchmaking',
    label: 'Matchmaking',
    path: (eventId) => `/events/${eventId}/matchmaking`,
  },
];

type Props = {
  eventId: string;
  /** Compact top-bar chips vs page header strip. */
  variant?: 'bar' | 'page';
  /**
   * When true, only show Matchmaking among the three (page headers that already
   * are SP/Meetings). When false/omitted, show all visible tiles.
   */
  matchmakingOnly?: boolean;
};

/**
 * Quick links between Solution Providers, Meetings, and Matchmaking.
 * Visibility follows event admin tiles (platform/super-admins see all).
 */
export default function EventFeatureNavLinks({
  eventId,
  variant = 'bar',
  matchmakingOnly = false,
}: Props) {
  const location = useLocation();
  const [loaded, setLoaded] = useState(false);
  const [tiles, setTiles] = useState<string[] | null>(null);
  const [viewAllTiles, setViewAllTiles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [platformAdmin, superAdmin, evRes] = await Promise.all([
        isCurrentUserPlatformAdmin(),
        canSuperAdminDeleteEvent(eventId),
        supabase.from('events').select('admin_console_tiles').eq('id', eventId).maybeSingle(),
      ]);
      if (cancelled) return;
      setViewAllTiles(platformAdmin || superAdmin);
      setTiles(
        normalizeAdminConsoleTiles(
          (evRes.data as { admin_console_tiles?: unknown } | null)?.admin_console_tiles,
        ),
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!loaded) return null;

  const items = FEATURES.filter((f) => {
    if (matchmakingOnly && f.id !== 'matchmaking') return false;
    return isEventAdminConsoleTileVisible(tiles, f.tileId, viewAllTiles);
  }).filter((f) => {
    const href = f.path(eventId);
    return !location.pathname.startsWith(href);
  });

  if (items.length === 0) return null;

  return (
    <nav
      className={variant === 'page' ? styles.pageNav : styles.barNav}
      aria-label="Related event tools"
    >
      {variant === 'page' ? <span className={styles.pageLabel}>Related</span> : null}
      {items.map((f) => (
        <Link key={f.id} to={f.path(eventId)} className={styles.link}>
          {f.label}
        </Link>
      ))}
    </nav>
  );
}
