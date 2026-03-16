import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import type { B2BFeedbackRow } from '../lib/types';
import styles from './B2BFeedback.module.css';

export default function B2BFeedback() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [list, setList] = useState<B2BFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<B2BFeedbackRow | null>(null);
  const [perf, setPerf] = useState<{ booth_id: string; vendor_name: string; feedback_count: number; avg_rating: number | null }[]>([]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: feedbackData, error } = await supabase.rpc('get_event_b2b_feedback', { p_event_id: eventId });
        if (error) throw error;
        if (!cancelled) setList((feedbackData as B2BFeedbackRow[]) ?? []);
        const { data: perfData } = await supabase.rpc('get_b2b_vendor_performance', {
          p_event_id: eventId,
          p_booth_id: null,
        });
        const arr = Array.isArray(perfData) ? perfData : [];
        if (!cancelled) setPerf(arr);
      } catch {
        if (!cancelled) setList([]);
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
      <h1>B2B meeting feedback — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>All attendee feedback for vendor meetings. Click Detail to see full feedback.</p>

      {perf.length > 0 && (
        <section className={styles.summary}>
          {perf.map((p) => (
            <div key={p.booth_id} className={styles.summaryCard}>
              <strong>{p.vendor_name}</strong>
              <span>{p.feedback_count} feedback · avg {p.avg_rating != null ? p.avg_rating.toFixed(1) : '—'}</span>
            </div>
          ))}
        </section>
      )}

      <h2 className={styles.listTitle}>All feedback ({list.length})</h2>
      {list.length === 0 ? (
        <p className={styles.empty}>No B2B meeting feedback yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Attendee</th>
                <th>Slot</th>
                <th>Rating</th>
                <th>Meet again</th>
                <th>Recommend</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id}>
                  <td>{row.vendor_name ?? '—'}</td>
                  <td>{row.attendee_name ?? row.attendee_email ?? '—'}</td>
                  <td>{row.slot_start ? new Date(row.slot_start).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                  <td>{row.rating}/5</td>
                  <td>{row.meet_again ? 'Yes' : 'No'}</td>
                  <td>{row.recommend_vendor ? 'Yes' : 'No'}</td>
                  <td>
                    <button type="button" className={styles.detailBtn} onClick={() => setDetail(row)}>
                      Detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className={styles.modalOverlay} onClick={() => setDetail(null)} role="dialog" aria-modal="true">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Feedback detail</h2>
              <button type="button" className={styles.modalClose} onClick={() => setDetail(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalRow}>
                <strong>Vendor</strong>
                {detail.vendor_name ?? '—'}
              </div>
              <div className={styles.modalRow}>
                <strong>Attendee</strong>
                {detail.attendee_name ?? '—'} {detail.attendee_email ? `(${detail.attendee_email})` : ''}
              </div>
              <div className={styles.modalRow}>
                <strong>Slot</strong>
                {detail.slot_start && detail.slot_end
                  ? `${new Date(detail.slot_start).toLocaleString()} – ${new Date(detail.slot_end).toLocaleTimeString()}`
                  : '—'}
              </div>
              <div className={styles.modalRow}>
                <strong>Rating</strong>
                {detail.rating}/5
              </div>
              <div className={styles.modalRow}>
                <strong>Meet again</strong>
                {detail.meet_again ? 'Yes' : 'No'}
              </div>
              <div className={styles.modalRow}>
                <strong>Recommend vendor</strong>
                {detail.recommend_vendor ? 'Yes' : 'No'}
              </div>
              <div className={styles.modalRow}>
                <strong>Work-with likelihood</strong>
                {detail.work_with_likelihood}/5
              </div>
              {detail.comment && (
                <div className={styles.modalRow}>
                  <strong>Comment</strong>
                  {detail.comment}
                </div>
              )}
              <div className={styles.modalRow}>
                <strong>Submitted</strong>
                {detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
