import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchEventsForAdminUser } from '../lib/fetchAdminEvents';
import type { Event } from '../lib/types';
import styles from './EventList.module.css';

export default function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchEventsForAdminUser();
        if (!cancelled) setEvents(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load events');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className={styles.loading}>Loading events…</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Your events</h1>
        <Link to="/events/new" className={styles.newBtn}>Create event</Link>
      </div>
      {events.length === 0 ? (
        <p className={styles.empty}>No events yet. Create one to get started.</p>
      ) : (
        <ul className={styles.list}>
          {events.map((ev) => (
            <li key={ev.id}>
              <Link to={`/events/${ev.id}`} className={styles.card}>
                <span className={styles.name}>{ev.name}</span>
                <span className={styles.meta}>
                  {ev.event_code ?? '—'} · {ev.start_date} – {ev.end_date}
                  {ev.is_active === false ? ' · Disabled' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
