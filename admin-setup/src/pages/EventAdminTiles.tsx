import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { canManageEventAdminConsoleTiles } from '../lib/canManageEventAdminConsoleTiles';
import {
  EVENT_ADMIN_CONSOLE_TILES,
  normalizeAdminConsoleTiles,
  type EventAdminConsoleTileId,
} from '../lib/eventAdminTiles';
import type { Event } from '../lib/types';
import styles from './EventAdminTiles.module.css';

export default function EventAdminTiles() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [tileDraft, setTileDraft] = useState<EventAdminConsoleTileId[]>([]);
  const [tileSaving, setTileSaving] = useState(false);
  const [tileSaveError, setTileSaveError] = useState('');
  const [tileSaveOk, setTileSaveOk] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const canManage = await canManageEventAdminConsoleTiles();
        if (cancelled) return;
        setAllowed(canManage);
        if (!canManage) {
          setLoading(false);
          return;
        }

        const fullSelect =
          'id, name, event_code, start_date, end_date, admin_console_tiles';
        const baseSelect = 'id, name, event_code, start_date, end_date';
        const { data, error: err } = await supabase.from('events').select(fullSelect).eq('id', eventId).single();
        let row: Event;
        if (err && /admin_console_tiles|schema cache/i.test(err.message)) {
          const fallback = await supabase.from('events').select(baseSelect).eq('id', eventId).single();
          if (fallback.error) throw fallback.error;
          row = fallback.data as Event;
        } else if (err) {
          throw err;
        } else {
          row = data as Event;
        }
        if (!cancelled) {
          setEvent(row);
          setTileDraft(normalizeAdminConsoleTiles(row.admin_console_tiles));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load event');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const toggleTileDraft = (id: EventAdminConsoleTileId, on: boolean) => {
    setTileDraft((prev) => {
      const set = new Set(prev);
      if (on) set.add(id);
      else set.delete(id);
      return EVENT_ADMIN_CONSOLE_TILES.map((t) => t.id).filter((key) => set.has(key));
    });
    setTileSaveOk(false);
  };

  const saveTileSettings = async () => {
    if (!eventId || tileSaving) return;
    if (tileDraft.length === 0) {
      setTileSaveError('Choose at least one tile for event admins.');
      return;
    }
    setTileSaveError('');
    setTileSaveOk(false);
    setTileSaving(true);
    try {
      const { error: upErr } = await supabase
        .from('events')
        .update({ admin_console_tiles: tileDraft })
        .eq('id', eventId);
      if (upErr) throw upErr;
      setEvent((prev) => (prev ? { ...prev, admin_console_tiles: [...tileDraft] } : prev));
      setTileSaveOk(true);
    } catch (e) {
      setTileSaveError(postgrestErrorMessage(e) || (e instanceof Error ? e.message : 'Save failed'));
    } finally {
      setTileSaving(false);
    }
  };

  if (!eventId) return <Navigate to="/" replace />;
  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!allowed) return <Navigate to={`/events/${eventId}`} replace />;
  if (error || !event) return <div className={styles.error}>{error || 'Event not found'}</div>;

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to={`/events/${eventId}`}>← Back to event</Link>
      </p>
      <div className={styles.head}>
        <div>
          <h1>Event admin tiles</h1>
          <p className={styles.subtitle}>
            {event.name}
            {event.event_code ? ` · ${event.event_code}` : ''} · {event.start_date} – {event.end_date}
          </p>
        </div>
      </div>

      <p className={styles.intro}>
        Choose which hub tiles <strong>event admins</strong> see on the event home screen. You (platform admin) always
        see every tile. Defaults for new events: Members, Schedule, Printable agenda, Photo book, and Announcements.
      </p>

      <div className={styles.panel}>
        <ul className={styles.tileCheckList}>
          {EVENT_ADMIN_CONSOLE_TILES.map((tile) => (
            <li key={tile.id}>
              <label className={styles.tileCheckLabel}>
                <input
                  type="checkbox"
                  checked={tileDraft.includes(tile.id)}
                  onChange={(e) => toggleTileDraft(tile.id, e.target.checked)}
                />
                <span>
                  <strong>{tile.title}</strong>
                  <span className={styles.tileCheckDesc}>{tile.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {tileSaveError ? <p className={styles.saveError}>{tileSaveError}</p> : null}
        {tileSaveOk ? <p className={styles.saveOk}>Saved.</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.saveBtn} disabled={tileSaving} onClick={saveTileSettings}>
            {tileSaving ? 'Saving…' : 'Save tile visibility'}
          </button>
          <Link to={`/events/${eventId}`} className={styles.cancelLink}>
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}
