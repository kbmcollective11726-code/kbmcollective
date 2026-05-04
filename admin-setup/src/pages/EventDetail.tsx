import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { canSuperAdminDeleteEvent } from '../lib/canSuperAdminDeleteEvent';
import { ADMIN_EVENTS_REFRESH } from '../components/EventContextBar';
import type { Event } from '../lib/types';
import styles from './EventDetail.module.css';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('events')
          .select('id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at')
          .eq('id', eventId)
          .single();
        if (err) throw err;
        if (!cancelled) setEvent(data as Event);
        const allowed = await canSuperAdminDeleteEvent(eventId);
        if (!cancelled) setCanDelete(allowed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load event');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

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

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error || !event) return <div className={styles.error}>{error || 'Event not found'}</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{event.name}</h1>
        <Link to={`/events/${eventId}/edit`} className={styles.editLink}>Edit event</Link>
      </div>
      <p className={styles.meta}>
        {event.event_code ?? '—'} · {event.start_date} – {event.end_date}
        {event.is_active === false ? ' · Disabled' : ''}
      </p>
      {event.description && <p className={styles.desc}>{event.description}</p>}
      <nav className={styles.nav}>
        <Link to={`/events/${eventId}/dashboard`} className={styles.card}>
          <span className={styles.cardTitle}>Member dashboard</span>
          <span className={styles.cardDesc}>Session & 1:1 Meeting feedback summary, top sessions, vendor performance</span>
        </Link>
        <Link to={`/events/${eventId}/members`} className={styles.card}>
          <span className={styles.cardTitle}>Members</span>
          <span className={styles.cardDesc}>View members or add from CSV (batch)</span>
        </Link>
        <Link to={`/events/${eventId}/schedule`} className={styles.card}>
          <span className={styles.cardTitle}>Schedule</span>
          <span className={styles.cardDesc}>Add sessions or import from CSV (batch)</span>
        </Link>
        <Link to={`/events/${eventId}/b2b-feedback`} className={styles.card}>
          <span className={styles.cardTitle}>1:1 Meeting feedback</span>
          <span className={styles.cardDesc}>View all vendor meeting ratings and comments</span>
        </Link>
        <Link to={`/events/${eventId}/session-feedback`} className={styles.card}>
          <span className={styles.cardTitle}>Session feedback</span>
          <span className={styles.cardDesc}>View all session ratings and comments</span>
        </Link>
        <Link to={`/events/${eventId}/vendor-booths`} className={styles.card}>
          <span className={styles.cardTitle}>Vendor booths (1:1 Meeting)</span>
          <span className={styles.cardDesc}>Add and edit vendor booths — same as the mobile app</span>
        </Link>
        <Link to={`/events/${eventId}/meetings`} className={styles.card}>
          <span className={styles.cardTitle}>Meetings</span>
          <span className={styles.cardDesc}>Assign 1:1 Meetings by booth — custom time per attendee; in-app + push notification each assignment</span>
        </Link>
        <Link to={`/events/${eventId}/announcements`} className={styles.card}>
          <span className={styles.cardTitle}>Announcements</span>
          <span className={styles.cardDesc}>Send announcements and push notifications to event members</span>
        </Link>
        <Link to={`/events/${eventId}/photos`} className={styles.card}>
          <span className={styles.cardTitle}>Photo book</span>
          <span className={styles.cardDesc}>Browse feed photos for this event, open full size, and download</span>
        </Link>
        <Link to={`/events/${eventId}/sponsors`} className={styles.card}>
          <span className={styles.cardTitle}>Sponsors</span>
          <span className={styles.cardDesc}>Tier labels, logos, and where they appear in the app (Info + hamburger menu)</span>
        </Link>
        <Link to={`/events/${eventId}/matchmaking`} className={styles.card}>
          <span className={styles.cardTitle}>Matchmaking</span>
          <span className={styles.cardDesc}>Build attendee/vendor registration forms, collect responses, and prepare meeting requests</span>
        </Link>
        <Link to={`/events/${eventId}/badges`} className={styles.card}>
          <span className={styles.cardTitle}>Badges</span>
          <span className={styles.cardDesc}>Print 3.75″×5.5″ QR badges for all members — footer line, tokens, and layouts</span>
        </Link>
        <Link to={`/events/${eventId}/scan-log`} className={styles.card}>
          <span className={styles.cardTitle}>Scan log</span>
          <span className={styles.cardDesc}>
            Badge scans from the app only: subject, scanner, kind, attendance, 1:1 meeting, notes, and timestamps
          </span>
        </Link>
        <Link to={`/events/${eventId}/safety`} className={styles.card}>
          <span className={styles.cardTitle}>Safety</span>
          <span className={styles.cardDesc}>
            User reports and blocks between members of this event (from the app profile screen)
          </span>
        </Link>
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
                Removes the event row and all database rows that reference it (members, feed, schedule, 1:1 Meetings, notifications, etc.).
                Uploaded files in storage may remain until cleaned separately.
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
