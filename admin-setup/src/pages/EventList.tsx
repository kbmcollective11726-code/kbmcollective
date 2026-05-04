import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchEventsForAdminUser } from '../lib/fetchAdminEvents';
import type { Event } from '../lib/types';
import styles from './EventList.module.css';

export default function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toLocalStart = (yyyyMmDd: string) => {
    const [ys, ms, ds] = (yyyyMmDd || '').split('-');
    const y = Number(ys || 1970);
    const m = Number(ms || 1);
    const d = Number(ds || 1);
    return new Date(y, m - 1, d);
  };

  const isPastEvent = (ev: Event) => toLocalStart(ev.end_date).getTime() < today.getTime();
  const currentOrUpcoming = events.filter((ev) => !isPastEvent(ev));
  const pastEvents = events.filter((ev) => isPastEvent(ev));

  const toggleEventActive = async (ev: Event) => {
    if (!ev?.id || savingId) return;
    setSavingId(ev.id);
    setError('');
    try {
      const { error: err } = await supabase
        .from('events')
        .update({ is_active: !ev.is_active, updated_at: new Date().toISOString() })
        .eq('id', ev.id);
      if (err) throw err;
      setEvents((prev) => prev.map((row) => (row.id === ev.id ? { ...row, is_active: !row.is_active } : row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update event status');
    } finally {
      setSavingId(null);
    }
  };

  const renderEventList = (rows: Event[]) => (
    <ul className={styles.list}>
      {rows.map((ev) => (
        <li key={ev.id}>
          <div className={styles.card}>
            <Link to={`/events/${ev.id}`} className={styles.eventLink}>
              <span className={styles.name}>{ev.name}</span>
              <span className={styles.meta}>
                {ev.event_code ?? '—'} · {ev.start_date} – {ev.end_date}
                {ev.is_active === false ? ' · Disabled' : ''}
              </span>
            </Link>
            <button
              type="button"
              className={ev.is_active ? styles.statusBtnWarn : styles.statusBtnOk}
              disabled={savingId === ev.id}
              onClick={() => toggleEventActive(ev)}
            >
              {savingId === ev.id ? 'Saving…' : ev.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Your events</h1>
        <Link to="/events/new" className={styles.newBtn}>Create event</Link>
      </div>
      {events.length === 0 ? (
        <p className={styles.empty}>No events yet. Create one to get started.</p>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Current / Upcoming</h2>
          {currentOrUpcoming.length > 0 ? (
            renderEventList(currentOrUpcoming)
          ) : (
            <p className={styles.empty}>No current events.</p>
          )}

          <h2 className={styles.sectionTitle}>Past events</h2>
          {pastEvents.length > 0 ? renderEventList(pastEvents) : <p className={styles.empty}>No past events.</p>}
        </>
      )}
    </div>
  );
}
