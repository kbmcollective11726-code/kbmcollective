import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './EventDetail.module.css';

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load event');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

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
          <span className={styles.cardTitle}>Dashboard</span>
          <span className={styles.cardDesc}>Session & B2B feedback summary, top sessions, vendor performance</span>
        </Link>
        <Link to={`/events/${eventId}/schedule`} className={styles.card}>
          <span className={styles.cardTitle}>Schedule</span>
          <span className={styles.cardDesc}>Add sessions or import from CSV (batch)</span>
        </Link>
        <Link to={`/events/${eventId}/members`} className={styles.card}>
          <span className={styles.cardTitle}>Members</span>
          <span className={styles.cardDesc}>View members or add from CSV (batch)</span>
        </Link>
        <Link to={`/events/${eventId}/b2b-feedback`} className={styles.card}>
          <span className={styles.cardTitle}>B2B meeting feedback</span>
          <span className={styles.cardDesc}>View all vendor meeting ratings and comments</span>
        </Link>
        <Link to={`/events/${eventId}/session-feedback`} className={styles.card}>
          <span className={styles.cardTitle}>Session feedback</span>
          <span className={styles.cardDesc}>View all session ratings and comments</span>
        </Link>
        <Link to={`/events/${eventId}/vendor-booths`} className={styles.card}>
          <span className={styles.cardTitle}>Vendor booths (B2B)</span>
          <span className={styles.cardDesc}>Add and edit vendor booths — same as the mobile app</span>
        </Link>
        <Link to={`/events/${eventId}/meetings`} className={styles.card}>
          <span className={styles.cardTitle}>Meetings</span>
          <span className={styles.cardDesc}>Manage B2B slots and assign attendees</span>
        </Link>
        <Link to={`/events/${eventId}/announcements`} className={styles.card}>
          <span className={styles.cardTitle}>Announcements</span>
          <span className={styles.cardDesc}>Send announcements and push notifications to event members</span>
        </Link>
      </nav>
    </div>
  );
}
