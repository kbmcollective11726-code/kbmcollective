import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type { Event } from '../lib/types';
import styles from './EventBadges.module.css';

type ScanRow = {
  scanner_kind: string;
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
  const [subjectQuery, setSubjectQuery] = useState('');
  const [scannerQuery, setScannerQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [meetingCompanyFilter, setMeetingCompanyFilter] = useState('all');

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

  const meetingCompanyFromLabel = useCallback((label: string | null | undefined) => {
    const raw = (label ?? '').trim();
    if (!raw) return '';
    // Labels are typically like "Cvent · May 07, 08:30 PM"
    const pieces = raw.split('·');
    return (pieces[0] ?? raw).trim();
  }, []);

  const filteredRows = useMemo(() => {
    const subjectQ = subjectQuery.trim().toLowerCase();
    const scannerQ = scannerQuery.trim().toLowerCase();
    return scanRows.filter((r) => {
      if (kindFilter !== 'all' && r.scanner_kind !== kindFilter) return false;
      if (meetingCompanyFilter !== 'all') {
        const company = meetingCompanyFromLabel(r.meeting?.label).toLowerCase();
        if (company !== meetingCompanyFilter.toLowerCase()) return false;
      }
      if (subjectQ) {
        const subjectText = `${r.subject.full_name} ${r.subject.email} ${r.subject.company ?? ''}`.toLowerCase();
        if (!subjectText.includes(subjectQ)) return false;
      }
      if (scannerQ) {
        const scannerText = `${r.scanner.full_name} ${r.scanner.email}`.toLowerCase();
        if (!scannerText.includes(scannerQ)) return false;
      }
      return true;
    });
  }, [scanRows, subjectQuery, scannerQuery, kindFilter, meetingCompanyFilter, meetingCompanyFromLabel]);

  const scannerKinds = useMemo(() => {
    const set = new Set<string>();
    for (const row of scanRows) {
      if (row.scanner_kind?.trim()) set.add(row.scanner_kind.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scanRows]);

  const meetingCompanies = useMemo(() => {
    const set = new Set<string>();
    for (const row of scanRows) {
      const company = meetingCompanyFromLabel(row.meeting?.label);
      if (company) set.add(company);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scanRows, meetingCompanyFromLabel]);

  const csvEscape = useCallback((v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }, []);

  const exportFilteredRows = useCallback(() => {
    if (filteredRows.length === 0) return;
    const headers = [
      'subject_name',
      'subject_email',
      'subject_company',
      'scanner_name',
      'scanner_email',
      'kind',
      'meeting_company',
      'meeting_label',
      'note',
      'updated_at',
    ];
    const lines = [headers.join(',')];
    for (const r of filteredRows) {
      const row = [
        r.subject.full_name ?? '',
        r.subject.email ?? '',
        r.subject.company ?? '',
        r.scanner.full_name ?? '',
        r.scanner.email ?? '',
        r.scanner_kind ?? '',
        meetingCompanyFromLabel(r.meeting?.label),
        r.meeting?.label ?? '',
        r.note ?? '',
        r.updated_at ? new Date(r.updated_at).toISOString() : '',
      ].map((v) => csvEscape(String(v)));
      lines.push(row.join(','));
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-log-${eventName || 'event'}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredRows, csvEscape, meetingCompanyFromLabel, eventName]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Notes log — {eventName || 'Event'}</h1>
      <p className={styles.hint}>
        Badge-scan notes from the KBM Connect app: who scanned whom, scanner role, 1:1 meeting slot context, notes, and last update time.
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>All notes</h2>
        <p className={styles.sectionHint}>Same data as vendors and admins see in-app; this list is event-wide for organizers.</p>
        <div className={styles.footerRow} style={{ marginBottom: 12 }}>
          <input
            className={styles.input}
            value={subjectQuery}
            onChange={(e) => setSubjectQuery(e.target.value)}
            placeholder="Filter by subject/person"
            aria-label="Filter by subject"
          />
          <input
            className={styles.input}
            value={scannerQuery}
            onChange={(e) => setScannerQuery(e.target.value)}
            placeholder="Filter by scanner"
            aria-label="Filter by scanner"
          />
          <select
            className={styles.input}
            style={{ maxWidth: 180 }}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="all">All kinds</option>
            {scannerKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <select
            className={styles.input}
            style={{ maxWidth: 180 }}
            value={meetingCompanyFilter}
            onChange={(e) => setMeetingCompanyFilter(e.target.value)}
            aria-label="Filter by 1:1 meeting company"
          >
            <option value="all">All 1:1 companies</option>
            {meetingCompanies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.btnGhost}
            style={{ marginBottom: 0 }}
            onClick={exportFilteredRows}
            disabled={filteredRows.length === 0}
          >
            Export filtered CSV
          </button>
        </div>
        {scanRows.length === 0 ? (
          <p className={styles.muted}>No scans yet.</p>
        ) : filteredRows.length === 0 ? (
          <p className={styles.muted}>No rows match those filters.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Scanner</th>
                  <th>Kind</th>
                  <th>1:1 meeting</th>
                  <th>Note</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => (
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
