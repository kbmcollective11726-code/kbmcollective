import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatB2BSlotRangeWallClock, formatB2BWhenLabelWallClock } from '../lib/b2bEventTime';
import type { Event } from '../lib/types';
import type { B2BFeedbackRow } from '../lib/types';
import styles from './B2BFeedback.module.css';

function escapeCsvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Wall-clock slot times — same numbers as Agenda / Bulk B2B (not browser TZ). */
function formatSlot(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '—';
  if (!end) return formatB2BWhenLabelWallClock(start);
  return formatB2BSlotRangeWallClock(start, end);
}

function formatSlotShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatB2BWhenLabelWallClock(iso);
}

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
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const exportCsv = () => {
    const header = [
      'Vendor',
      'Attendee',
      'Email',
      'Slot start',
      'Slot end',
      'Rating',
      'Meet again',
      'Recommend',
      'Work-with likelihood',
      'Comment',
      'Submitted',
    ];
    const lines = [
      header.join(','),
      ...list.map((row) =>
        [
          escapeCsvCell(row.vendor_name ?? ''),
          escapeCsvCell(row.attendee_name ?? ''),
          escapeCsvCell(row.attendee_email ?? ''),
          escapeCsvCell(row.slot_start ? formatB2BWhenLabelWallClock(row.slot_start) : ''),
          escapeCsvCell(row.slot_end ? formatB2BWhenLabelWallClock(row.slot_end) : ''),
          String(row.rating),
          row.meet_again ? 'Yes' : 'No',
          row.recommend_vendor ? 'Yes' : 'No',
          String(row.work_with_likelihood),
          escapeCsvCell(row.comment?.trim() ?? ''),
          escapeCsvCell(row.created_at ? new Date(row.created_at).toLocaleString() : ''),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `b2b-feedback-${eventId?.slice(0, 8) ?? 'export'}.csv`;
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
        <h1>1:1 Meeting feedback — {event?.name ?? 'Event'}</h1>
        <p className={styles.meta}>All attendee feedback for vendor meetings.</p>
        {list.length > 0 ? <p className={styles.meta}>{list.length} response{list.length === 1 ? '' : 's'}</p> : null}
      </header>

      {perf.length > 0 && (
        <section className={styles.summary}>
          {perf.map((p) => (
            <div key={p.booth_id} className={styles.summaryCard}>
              <strong>{p.vendor_name}</strong>
              <span>
                {p.feedback_count} feedback · avg {p.avg_rating != null ? p.avg_rating.toFixed(1) : '—'}
              </span>
            </div>
          ))}
        </section>
      )}

      <h2 className={styles.listTitle}>All feedback ({list.length})</h2>
      {list.length === 0 ? (
        <p className={styles.empty}>No 1:1 Meeting feedback yet.</p>
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
                <th>Comment</th>
                <th className={styles.noPrintCol}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id}>
                  <td>{row.vendor_name ?? '—'}</td>
                  <td>{row.attendee_name ?? row.attendee_email ?? '—'}</td>
                  <td>{formatSlotShort(row.slot_start)}</td>
                  <td>{row.rating}/5</td>
                  <td>{row.meet_again ? 'Yes' : 'No'}</td>
                  <td>{row.recommend_vendor ? 'Yes' : 'No'}</td>
                  <td className={styles.commentCell}>{row.comment?.trim() ? row.comment : '—'}</td>
                  <td className={styles.noPrintCol}>
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

      {detail ? (
        <div className={styles.modalOverlay} onClick={() => setDetail(null)} role="dialog" aria-modal="true" aria-labelledby="b2b-feedback-detail-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 id="b2b-feedback-detail-title">Feedback detail</h2>
              <button type="button" className={styles.modalClose} onClick={() => setDetail(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalRow}>
                <strong>Vendor</strong>
                <span>{detail.vendor_name ?? '—'}</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Attendee</strong>
                <span>
                  {detail.attendee_name ?? '—'}
                  {detail.attendee_email ? ` (${detail.attendee_email})` : ''}
                </span>
              </div>
              <div className={styles.modalRow}>
                <strong>Slot</strong>
                <span>{formatSlot(detail.slot_start, detail.slot_end)}</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Rating</strong>
                <span>{detail.rating}/5</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Meet again</strong>
                <span>{detail.meet_again ? 'Yes' : 'No'}</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Recommend vendor</strong>
                <span>{detail.recommend_vendor ? 'Yes' : 'No'}</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Work-with likelihood</strong>
                <span>{detail.work_with_likelihood}/5</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Comment</strong>
                <span className={styles.modalComment}>{detail.comment?.trim() ? detail.comment : '—'}</span>
              </div>
              <div className={styles.modalRow}>
                <strong>Submitted</strong>
                <span>{detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
