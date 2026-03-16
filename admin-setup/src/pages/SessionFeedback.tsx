import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import type { SessionRatingRow } from '../lib/types';
import styles from './SessionFeedback.module.css';

export default function SessionFeedback() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [list, setList] = useState<SessionRatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: rows, error: rpcError } = await supabase.rpc('get_event_session_feedback', { p_event_id: eventId });
        if (rpcError) throw rpcError;
        if (!cancelled) setList((rows as SessionRatingRow[]) ?? []);
      } catch (e) {
        if (!cancelled) {
          setList([]);
          setError(e instanceof Error ? e.message : 'Failed to load session feedback.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Session feedback — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>All session ratings (1–5 and comments) from attendees.</p>

      {error && <p className={styles.error}>{error}</p>}

      <h2 className={styles.listTitle}>Ratings ({list.length})</h2>
      {list.length === 0 ? (
        <p className={styles.empty}>{error ? 'Could not load ratings.' : 'No session feedback yet.'}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Session</th>
                <th>User</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id}>
                  <td>{row.session_title ?? '—'}</td>
                  <td>{row.user_name ?? row.user_email ?? row.user_id}</td>
                  <td>{row.rating}/5</td>
                  <td>{row.comment ? (row.comment.length > 60 ? row.comment.slice(0, 60) + '…' : row.comment) : '—'}</td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
