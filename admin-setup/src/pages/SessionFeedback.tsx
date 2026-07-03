import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import type { SessionRatingRow } from '../lib/types';
import styles from './SessionFeedback.module.css';

function escapeCsvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatSubmittedAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

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
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const exportCsv = () => {
    const header = ['Session', 'User', 'Email', 'Rating', 'Comment', 'Submitted'];
    const lines = [
      header.join(','),
      ...list.map((row) =>
        [
          escapeCsvCell(row.session_title ?? ''),
          escapeCsvCell(row.user_name ?? ''),
          escapeCsvCell(row.user_email ?? ''),
          String(row.rating),
          escapeCsvCell(row.comment?.trim() ?? ''),
          escapeCsvCell(formatSubmittedAt(row.created_at)),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-feedback-${eventId?.slice(0, 8) ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
        {list.length > 0 ? (
          <div className={styles.toolbarActions}>
            <button type="button" className={styles.btn} onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className={styles.btnPrimary} onClick={exportCsv}>
              Download CSV
            </button>
          </div>
        ) : null}
      </div>

      <header className={styles.printHead}>
        <h1>Session feedback — {event?.name ?? 'Event'}</h1>
        <p className={styles.meta}>All session ratings (1–5 and comments) from attendees.</p>
        {list.length > 0 ? <p className={styles.meta}>{list.length} rating{list.length === 1 ? '' : 's'}</p> : null}
      </header>

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
                  <td className={styles.commentCell}>{row.comment?.trim() ? row.comment : '—'}</td>
                  <td>{formatSubmittedAt(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
