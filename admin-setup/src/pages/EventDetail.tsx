import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { canSuperAdminDeleteEvent } from '../lib/canSuperAdminDeleteEvent';
import { canManageEventAdminConsoleTiles } from '../lib/canManageEventAdminConsoleTiles';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { ADMIN_EVENTS_REFRESH } from '../components/EventContextBar';
import {
  EVENT_ADMIN_CONSOLE_TILES,
  normalizeAdminConsoleTiles,
  isEventAdminConsoleTileVisible,
} from '../lib/eventAdminTiles';
import type { Event } from '../lib/types';
import {
  isEventNotificationsPausedActive,
  notifPauseDurationFromEvent,
  type NotifPauseDuration,
} from '../lib/eventNotificationsPaused';
import styles from './EventDetail.module.css';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [canManageTiles, setCanManageTiles] = useState(false);
  const [viewAllTiles, setViewAllTiles] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [savingNotifMute, setSavingNotifMute] = useState(false);
  const [notifMuteError, setNotifMuteError] = useState('');
  const [notifPauseHours, setNotifPauseHours] = useState<NotifPauseDuration>('2');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        let row: Event;
        const fullSelect =
          'id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at, updated_at, admin_console_tiles, notifications_paused, notifications_paused_until';
        const baseSelect =
          'id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at, updated_at, notifications_paused, notifications_paused_until';
        const { data, error: err } = await supabase.from('events').select(fullSelect).eq('id', eventId).single();
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
          setNotifPauseHours(notifPauseDurationFromEvent(row));
        }

        const [eventSuperAdmin, pa, manageTiles] = await Promise.all([
          canSuperAdminDeleteEvent(eventId),
          isCurrentUserPlatformAdmin(),
          canManageEventAdminConsoleTiles(),
        ]);
        if (!cancelled) {
          setCanDelete(eventSuperAdmin);
          setPlatformAdmin(pa);
          setCanManageTiles(manageTiles);
          setViewAllTiles(pa || eventSuperAdmin);
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

  const visibleTiles = useMemo(() => {
    if (!eventId) return [];
    const tiles = normalizeAdminConsoleTiles(event?.admin_console_tiles);
    return EVENT_ADMIN_CONSOLE_TILES.filter((t) =>
      isEventAdminConsoleTileVisible(tiles, t.id, viewAllTiles)
    );
  }, [event?.admin_console_tiles, eventId, viewAllTiles]);

  const handleDeleteEvent = async () => {
    if (!eventId || !event?.name || deleting) return;
    const ok = window.confirm(
      'Delete this event permanently? All members, posts, schedule, booths, meetings, announcements, and other linked data will be removed. This cannot be undone.'
    );
    if (!ok) return;
    const typed = window.prompt(`Type the event name exactly to confirm:\n\n${event.name}`);
    if (typed !== event.name) {
      if (typed !== null) setDeleteError('Name did not match. Nothing was deleted.');
      return;
    }
    setDeleteError('');
    setDeleting(true);
    try {
      const { error: delErr } = await supabase.from('events').delete().eq('id', eventId);
      if (delErr) throw delErr;
      window.dispatchEvent(new Event(ADMIN_EVENTS_REFRESH));
      navigate('/', { replace: true });
    } catch (e) {
      setDeleteError(postgrestErrorMessage(e) || (e instanceof Error ? e.message : 'Delete failed'));
    } finally {
      setDeleting(false);
    }
  };

  const notificationsPausedActive = isEventNotificationsPausedActive(event);

  const pausedUntilLabel =
    event?.notifications_paused_until && !Number.isNaN(new Date(event.notifications_paused_until).getTime())
      ? new Date(event.notifications_paused_until).toLocaleString()
      : '';

  const handleToggleNotificationsPaused = async (next: boolean) => {
    if (!eventId) return;
    setNotifMuteError('');
    setSavingNotifMute(true);
    try {
      const updated_at = new Date().toISOString();
      const notifications_paused_until =
        next && notifPauseHours !== 'indefinite'
          ? new Date(Date.now() + Number(notifPauseHours) * 60 * 60 * 1000).toISOString()
          : null;
      const { error: upErr } = await supabase
        .from('events')
        .update({ notifications_paused: next, notifications_paused_until, updated_at })
        .eq('id', eventId);
      if (upErr) throw upErr;
      const nextEvent = event
        ? { ...event, notifications_paused: next, notifications_paused_until, updated_at }
        : null;
      setEvent(nextEvent);
      if (nextEvent) setNotifPauseHours(notifPauseDurationFromEvent(nextEvent));
    } catch (e) {
      setNotifMuteError(postgrestErrorMessage(e) || 'Failed to update notification mute');
    } finally {
      setSavingNotifMute(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error || !event) return <div className={styles.error}>{error || 'Event not found'}</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{event.name}</h1>
        <div className={styles.headActions}>
          {canManageTiles ? (
            <Link to={`/events/${eventId}/event-admin-tiles`} className={styles.tileManageLink}>
              Event admin tiles
            </Link>
          ) : null}
          <Link to={`/events/${eventId}/edit`} className={styles.editLink}>
            Edit event
          </Link>
        </div>
      </div>
      <p className={styles.meta}>
        {event.event_code ?? '—'} · {event.start_date} – {event.end_date}
        {event.is_active === false ? ' · Disabled' : ''}
        {platformAdmin ? (
          <span className={styles.roleBadge}>Platform admin</span>
        ) : canDelete ? (
          <span className={styles.roleBadgeMuted}>Event super-admin</span>
        ) : null}
      </p>
      {event.description && <p className={styles.desc}>{event.description}</p>}
      <section className={styles.notifControl}>
        <h2 className={styles.notifTitle}>Event notifications</h2>
        <p className={styles.notifHint}>
          Pause attendee alerts while making major schedule or meeting changes. When paused, event-scoped in-app and
          push notifications are muted.
        </p>
        <div className={styles.notifControlsRow}>
          <label className={styles.notifDurationLabel}>
            Auto-unmute
            <select
              value={notifPauseHours}
              onChange={(e) => setNotifPauseHours(e.target.value as NotifPauseDuration)}
              disabled={savingNotifMute || notificationsPausedActive}
              className={styles.notifDurationSelect}
            >
              <option value="2">in 2 hours</option>
              <option value="6">in 6 hours</option>
              <option value="24">in 24 hours</option>
              <option value="indefinite">manual only</option>
            </select>
          </label>
        </div>
        <label className={styles.notifToggleLabel}>
          <input
            type="checkbox"
            checked={notificationsPausedActive}
            disabled={savingNotifMute}
            onChange={(e) => void handleToggleNotificationsPaused(e.target.checked)}
          />
          <span>{notificationsPausedActive ? 'Notifications paused for this event' : 'Notifications active'}</span>
        </label>
        {notificationsPausedActive && pausedUntilLabel ? (
          <p className={styles.notifHint}>Auto-unmute: {pausedUntilLabel}</p>
        ) : null}
        {notifMuteError ? <p className={styles.notifError}>{notifMuteError}</p> : null}
      </section>

      <nav className={styles.nav}>
        {visibleTiles.map((tile) => (
          <Link key={tile.id} to={tile.to(eventId!)} className={styles.card}>
            <span className={styles.cardTitle}>{tile.title}</span>
            <span className={styles.cardDesc}>{tile.desc}</span>
          </Link>
        ))}
      </nav>

      {canDelete ? (
        <section className={styles.dangerZone}>
          <button type="button" className={styles.dangerToggle} onClick={() => setShowDelete((v) => !v)}>
            {showDelete ? 'Hide' : 'Show'} super-admin actions
          </button>
          {showDelete ? (
            <div className={styles.dangerPanel}>
              <h2 className={styles.dangerTitle}>Delete event</h2>
              <p className={styles.dangerText}>
                Removes the event row and all database rows that reference it (members, feed, schedule, 1:1 Meetings,
                notifications, etc.). Uploaded files in storage may remain until cleaned separately.
              </p>
              {deleteError ? <p className={styles.dangerError}>{deleteError}</p> : null}
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={deleting}
                onClick={handleDeleteEvent}
              >
                {deleting ? 'Deleting…' : 'Delete event and all data'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
