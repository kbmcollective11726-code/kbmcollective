import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type { Event } from '../lib/types';
import styles from './EventBadges.module.css';

type ScanRow = {
  scanner_kind: string;
  attended_meeting: boolean;
  note: string | null;
  updated_at: string;
  meeting: { id: string; label: string } | null;
  scanner: { full_name: string; email: string };
  subject: { full_name: string; email: string; company: string };
};

export default function EventScanLog() {
  const { eventId } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState('');
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    setLoading(true);
    try {
      const { data: ev, error: evErr } = await supabase.from('events').select('id, name').eq('id', eventId).single();
      if (evErr) throw evErr;
      setEventName((ev as Event).name ?? '');

      const { data: scanData, error: scanErr } = await supabase.rpc('list_event_badge_scans', {
        p_event_id: eventId,
      });
      if (scanErr) {
        if (!String(scanErr.message).includes('does not exist')) throw scanErr;
        setScanRows([]);
      } else {
        const pack = scanData as { rows?: ScanRow[]; error?: string } | null;
        if (pack?.error) throw new Error(pack.error);
        setScanRows(Array.isArray(pack?.rows) ? pack!.rows! : []);
      }
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setScanRows([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Scan log — {eventName || 'Event'}</h1>
      <p className={styles.hint}>
        Badge scans from the KBM Connect app: who scanned whom, scanner role, 1:1 meeting slot (vendor name and time
        when a booking is linked or when attendance was saved per meeting), notes, and last update time.
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>All scans</h2>
        <p className={styles.sectionHint}>Same data as vendors and admins see in-app; this list is event-wide for organizers.</p>
        {scanRows.length === 0 ? (
          <p className={styles.muted}>No scans yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Scanner</th>
                  <th>Kind</th>
                  <th>Attended</th>
                  <th>1:1 meeting</th>
                  <th>Note</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {scanRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.subject.full_name}
                      <div className={styles.smallMuted}>{r.subject.email}</div>
                    </td>
                    <td>
                      {r.scanner.full_name}
                      <div className={styles.smallMuted}>{r.scanner.email}</div>
                    </td>
                    <td>{r.scanner_kind}</td>
                    <td>{r.attended_meeting ? 'Yes' : '—'}</td>
                    <td className={styles.noteCell}>{r.meeting?.label ?? '—'}</td>
                    <td className={styles.noteCell}>{r.note ?? '—'}</td>
                    <td className={styles.smallMuted}>{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
