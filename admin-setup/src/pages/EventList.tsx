import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;

        const { data: profile } = await supabase
          .from('users')
          .select('is_platform_admin')
          .eq('id', user.id)
          .single();

        const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

        if (isPlatformAdmin) {
          const { data, error: err } = await supabase
            .from('events')
            .select('id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at')
            .order('created_at', { ascending: false });
          if (err) throw err;
          if (!cancelled) setEvents((data as Event[]) ?? []);
        } else {
          const { data: memberRows } = await supabase
            .from('event_members')
            .select('event_id')
            .eq('user_id', user.id)
            .in('role', ['admin', 'super_admin']);
          const ids = [...new Set((memberRows ?? []).map((r: { event_id: string }) => r.event_id))];
          if (ids.length === 0) {
            if (!cancelled) setEvents([]);
            return;
          }
          const { data, error: err } = await supabase
            .from('events')
            .select('id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at')
            .in('id', ids)
            .order('created_at', { ascending: false });
          if (err) throw err;
          if (!cancelled) setEvents((data as Event[]) ?? []);
        }
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
