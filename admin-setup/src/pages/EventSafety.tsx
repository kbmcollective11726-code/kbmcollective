import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type { Event } from '../lib/types';
import styles from './EventBadges.module.css';

type SafetyUser = { user_id: string; full_name: string; email: string };

type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  created_at: string;
  reporter: SafetyUser;
  reported: SafetyUser;
};

type BlockRow = {
  id: string;
  created_at: string;
  blocker: SafetyUser;
  blocked: SafetyUser;
};

export default function EventSafety() {
  const { eventId } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState('');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
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

      const { data: pack, error: rpcErr } = await supabase.rpc('list_event_safety_records', {
        p_event_id: eventId,
      });
      if (rpcErr) {
        if (!String(rpcErr.message).includes('does not exist')) throw rpcErr;
        setReports([]);
        setBlocks([]);
        return;
      }
      const body = pack as { reports?: ReportRow[]; blocks?: BlockRow[]; error?: string } | null;
      if (body?.error) throw new Error(body.error);
      setReports(Array.isArray(body?.reports) ? body!.reports! : []);
      setBlocks(Array.isArray(body?.blocks) ? body!.blocks! : []);
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setReports([]);
      setBlocks([]);
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
      <h1>Safety — {eventName || 'Event'}</h1>
      <p className={styles.hint}>
        User reports and blocks where <strong>both</strong> people are members of this event. Reports come from the
        app profile screen; blocks are stored when someone uses Block there.
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Reports</h2>
        <p className={styles.sectionHint}>Reason and optional details submitted by the reporter.</p>
        {reports.length === 0 ? (
          <p className={styles.muted}>No reports for this event yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reporter</th>
                  <th>Reported user</th>
                  <th>Reason</th>
                  <th>Details</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.reporter.full_name}
                      <div className={styles.smallMuted}>{r.reporter.email}</div>
                    </td>
                    <td>
                      {r.reported.full_name}
                      <div className={styles.smallMuted}>{r.reported.email}</div>
                    </td>
                    <td>{r.reason}</td>
                    <td className={styles.noteCell}>{r.details?.trim() ? r.details : '—'}</td>
                    <td className={styles.smallMuted}>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Blocks</h2>
        <p className={styles.sectionHint}>Blocker chose to block the other user (both are event members).</p>
        {blocks.length === 0 ? (
          <p className={styles.muted}>No blocks between event members yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Blocker</th>
                  <th>Blocked</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.blocker.full_name}
                      <div className={styles.smallMuted}>{b.blocker.email}</div>
                    </td>
                    <td>
                      {b.blocked.full_name}
                      <div className={styles.smallMuted}>{b.blocked.email}</div>
                    </td>
                    <td className={styles.smallMuted}>{new Date(b.created_at).toLocaleString()}</td>
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
