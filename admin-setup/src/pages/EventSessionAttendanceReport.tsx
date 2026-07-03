import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  formatSessionSlotRange,
  getSessionAttendanceReport,
  type SessionAttendanceReportRow,
} from '../lib/sessionCheckInRpc';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import styles from './SessionAttendanceReport.module.css';

function escapeCsvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatCheckedInAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function EventSessionAttendanceReport() {
  const { eventId, sessionId } = useParams<{ eventId: string; sessionId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionMeta, setSessionMeta] = useState('');
  const [rows, setRows] = useState<SessionAttendanceReportRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError('');
    const res = await getSessionAttendanceReport(sessionId);
    if (res.error) {
      setError(postgrestErrorMessage(new Error(res.error)));
      setRows([]);
    } else {
      const sess = res.session ?? {};
      setSessionTitle(String(sess.title ?? 'Session'));
      setSessionMeta(
        formatSessionSlotRange(sess.start_time as string, sess.end_time as string) +
          (sess.room || sess.location
            ? ` · ${[sess.room, sess.location].filter(Boolean).join(', ')}`
            : '')
      );
      setRows(res.rows ?? []);
      setStats(res.stats ?? {});
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.checked_in !== b.checked_in) return a.checked_in ? -1 : 1;
      return (a.full_name || a.email).localeCompare(b.full_name || b.email);
    });
  }, [rows]);

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Company', 'Bookmarked', 'Checked in', 'Check-in time', 'Scanned by'];
    const lines = [
      header.join(','),
      ...sortedRows.map((r) =>
        [
          escapeCsvCell(r.full_name),
          escapeCsvCell(r.email),
          escapeCsvCell(r.company),
          r.bookmarked ? 'Yes' : 'No',
          r.checked_in ? 'Yes' : 'No',
          escapeCsvCell(r.checked_in ? formatCheckedInAt(r.checked_in_at) : ''),
          escapeCsvCell(r.checked_in_by_name ?? ''),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-attendance-${sessionId?.slice(0, 8) ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    document.title = sessionTitle ? `Attendance — ${sessionTitle}` : 'Session attendance';
    return () => {
      document.title = 'KBM Connect Admin — Event Setup';
    };
  }, [sessionTitle]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link to={`/events/${eventId}/session-attendance`} className={styles.back}>
          ← Sessions
        </Link>
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.btn} onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className={styles.btnPrimary} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <header className={styles.printHead}>
        <h1>{sessionTitle}</h1>
        {sessionMeta ? <p className={styles.meta}>{sessionMeta}</p> : null}
        <p className={styles.statsLine}>
          {stats.checked_in_count ?? 0} checked in · {stats.bookmarked_count ?? 0} bookmarked ·{' '}
          {stats.bookmarked_no_show ?? 0} bookmarked, did not check in
        </p>
      </header>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Company</th>
            <th>Bookmarked</th>
            <th>Status</th>
            <th>Check-in time</th>
            <th>Scanned by</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={7} className={styles.empty}>
                No bookmarks or check-ins yet for this session.
              </td>
            </tr>
          ) : (
            sortedRows.map((r) => (
              <tr key={r.user_id} className={!r.checked_in && r.bookmarked ? styles.noShow : undefined}>
                <td>{r.full_name || '—'}</td>
                <td>{r.email || '—'}</td>
                <td>{r.company || '—'}</td>
                <td>{r.bookmarked ? 'Yes' : 'No'}</td>
                <td>
                  {r.checked_in ? (
                    <span className={styles.badgeOk}>Checked in</span>
                  ) : r.bookmarked ? (
                    <span className={styles.badgeMiss}>Did not check in</span>
                  ) : (
                    <span className={styles.badgeWalk}>Walk-in</span>
                  )}
                </td>
                <td>{r.checked_in ? formatCheckedInAt(r.checked_in_at) : '—'}</td>
                <td>{r.checked_in_by_name || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
