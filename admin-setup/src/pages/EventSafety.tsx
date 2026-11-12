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
  event_id?: string | null;
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
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const clearReport = async (r: ReportRow) => {
    if (
      !window.confirm(
        `Clear report against "${r.reported.full_name || r.reported.email}"?\n\nUse this for test or mistaken reports.`
      )
    ) {
      return;
    }
    setError('');
    setBusyId(r.id);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_clear_user_report', {
        p_report_id: r.id,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not clear report');
      setReports((prev) => prev.filter((row) => row.id !== r.id));
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const clearAllReports = async () => {
    if (reports.length === 0) return;
    if (
      !window.confirm(
        `Clear all ${reports.length} report(s) for this event?\n\nThis permanently removes them (good for wiping test data).`
      )
    ) {
      return;
    }
    setError('');
    setBusyId('__all_reports__');
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_clear_user_reports', {
        p_report_ids: reports.map((r) => r.id),
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not clear reports');
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const unblock = async (b: BlockRow) => {
    if (
      !window.confirm(
        `Unblock "${b.blocked.full_name || b.blocked.email}"?\n\nThey will be able to interact with "${b.blocker.full_name || b.blocker.email}" again.`
      )
    ) {
      return;
    }
    setError('');
    setBusyId(b.id);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_remove_user_block', {
        p_block_id: b.id,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not unblock');
      setBlocks((prev) => prev.filter((row) => row.id !== b.id));
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

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
        User reports and blocks tied to this event. Use <strong>Clear</strong> to remove test reports and{' '}
        <strong>Unblock</strong> to reverse a block. New reports include the event they were filed under; older rows may
        appear when both people were members here.
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Reports</h2>
          {reports.length > 0 ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busyId !== null}
              onClick={() => void clearAllReports()}
            >
              {busyId === '__all_reports__' ? 'Clearing…' : 'Clear all'}
            </button>
          ) : null}
        </div>
        <p className={styles.sectionHint}>
          Reason and optional details submitted by the reporter. Clear removes the report permanently (for tests or
          mistakes).
        </p>
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
                  <th>Actions</th>
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
                    <td>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={busyId !== null}
                        onClick={() => void clearReport(r)}
                      >
                        {busyId === r.id ? '…' : 'Clear'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Blocks</h2>
        <p className={styles.sectionHint}>
          Blocker chose to block the other user. Unblock restores normal interaction between them.
        </p>
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
                  <th>Actions</th>
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
                    <td>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={busyId !== null}
                        onClick={() => void unblock(b)}
                      >
                        {busyId === b.id ? '…' : 'Unblock'}
                      </button>
                    </td>
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
