import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { canSuperAdminDeleteEvent } from '../lib/canSuperAdminDeleteEvent';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import {
  EVENT_ADMIN_CONSOLE_PATH_SEGMENT_TO_TILE,
  isEventAdminConsoleTileVisible,
} from '../lib/eventAdminTiles';

/**
 * Blocks event admins from deep-linking into admin console sections hidden on the event hub.
 * Platform admins always pass through.
 */
export default function EventAdminTileGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const match = useMatch({ path: '/events/:eventId/*', end: false });
  const eventId = match?.params.eventId;
  const rest = match?.params['*'] ?? '';
  const firstSegment = rest.split('/').filter(Boolean)[0] ?? '';

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setChecking(false);
      return;
    }

    const tileId = EVENT_ADMIN_CONSOLE_PATH_SEGMENT_TO_TILE[firstSegment];
    if (!tileId || firstSegment === 'edit') {
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [platformAdmin, eventSuperAdmin] = await Promise.all([
          isCurrentUserPlatformAdmin(),
          canSuperAdminDeleteEvent(eventId),
        ]);
        if (cancelled) return;
        if (platformAdmin || eventSuperAdmin) {
          setChecking(false);
          return;
        }

        const { data, error } = await supabase
          .from('events')
          .select('admin_console_tiles')
          .eq('id', eventId)
          .maybeSingle();

        if (cancelled) return;

        if (error && /admin_console_tiles|schema cache/i.test(error.message)) {
          setChecking(false);
          return;
        }

        const tiles = (data as { admin_console_tiles?: string[] | null } | null)?.admin_console_tiles;
        const allowed = isEventAdminConsoleTileVisible(tiles, tileId, false);
        if (!allowed) {
          navigate(`/events/${eventId}`, { replace: true });
          return;
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, firstSegment, navigate]);

  if (checking && eventId && EVENT_ADMIN_CONSOLE_PATH_SEGMENT_TO_TILE[firstSegment]) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return <>{children}</>;
}
