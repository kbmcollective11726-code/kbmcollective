import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { EventMeetingInterestRequest } from '../../lib/types';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

export default function DelegateMeetingSent() {
  const { submission, settings } = useOutletContext<DelegatePortalContext>();
  const [rows, setRows] = useState<EventMeetingInterestRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('event_meeting_interest_requests')
        .select('*')
        .eq('submission_id', submission.id)
        .order('priority', { ascending: true });
      if (!cancelled) {
        if (!error) setRows((data as EventMeetingInterestRequest[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.id]);

  if (!settings.meeting_requests_open) {
    return (
      <div className={styles.card}>
        <h1>Sent</h1>
        <p className={styles.hint}>Meeting requests are not open yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h1>Sent meeting requests</h1>
      {loading ? <p className={styles.hint}>Loading…</p> : null}
      {!loading && rows.length === 0 ? <p className={styles.hint}>You have not submitted any meeting requests yet.</p> : null}
      {!loading && rows.length > 0 ? (
        <table className={styles.listTable}>
          <thead>
            <tr>
              <th>Company</th>
              <th>Person</th>
              <th>Notes</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.target_company_name ?? '—'}</td>
                <td>{r.target_person_name ?? '—'}</td>
                <td>{r.reason ?? '—'}</td>
                <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
