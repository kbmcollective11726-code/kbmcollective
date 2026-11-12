import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatB2BSlotRangeWallClock } from '../../lib/b2bEventTime';
import { loadParticipantMatchmakingSchedule } from '../../lib/meetingRequests';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { ParticipantMatchmakingMeeting } from '../../lib/types';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
}

export default function MeetingTimes({ eventId, submissionId }: Props) {
  const [rows, setRows] = useState<ParticipantMatchmakingMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await loadParticipantMatchmakingSchedule(eventId, submissionId));
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not load meeting times');
    } finally {
      setLoading(false);
    }
  }, [eventId, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeRows = useMemo(
    () => rows.filter((row) => row.status === 'scheduled'),
    [rows],
  );
  const historyRows = useMemo(
    () => rows.filter((row) => row.status !== 'scheduled'),
    [rows],
  );

  const renderTable = (meetings: ParticipantMatchmakingMeeting[]) => (
    <div className={styles.tableWrap}>
      <table className={styles.listTable}>
        <thead>
          <tr>
            <th>Date and time</th>
            <th>Company</th>
            <th>Contact</th>
            <th>Location</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((meeting) => (
            <tr key={meeting.id}>
              <td>
                <strong>{formatB2BSlotRangeWallClock(meeting.start_time, meeting.end_time)}</strong>
                {meeting.slot_label ? <div className={styles.hint}>{meeting.slot_label}</div> : null}
              </td>
              <td>{meeting.counterpart_company_name || '—'}</td>
              <td>
                {[meeting.counterpart_first_name, meeting.counterpart_last_name]
                  .filter(Boolean)
                  .join(' ') || '—'}
                {meeting.counterpart_job_title ? (
                  <div className={styles.hint}>{meeting.counterpart_job_title}</div>
                ) : null}
              </td>
              <td>{meeting.location || 'To be announced'}</td>
              <td>
                <span className={`${styles.statusPill} ${styles[`status${meeting.status}`]}`}>
                  {meeting.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className={styles.card}>
      <h1>Meeting Times</h1>
      <p className={styles.lead}>
        Your organizer-finalized 1-on-1 schedule appears here. Changes are also
        synchronized to the mobile app after publication.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.hint}>Loading…</p> : null}
      {!loading && activeRows.length === 0 ? (
        <p className={styles.hint}>No meetings have been scheduled yet.</p>
      ) : null}
      {activeRows.length > 0 ? renderTable(activeRows) : null}
      {historyRows.length > 0 ? (
        <>
          <h2 className={styles.subheading}>Meeting history</h2>
          {renderTable(historyRows)}
        </>
      ) : null}
    </section>
  );
}
