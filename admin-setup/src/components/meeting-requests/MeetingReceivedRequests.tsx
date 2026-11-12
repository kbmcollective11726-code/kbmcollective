import { useCallback, useEffect, useMemo, useState } from 'react';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import {
  interestLevelLabel,
  loadReceivedMeetingRequests,
  respondToMeetingRequest,
} from '../../lib/meetingRequests';
import type { ReceivedMeetingRequest } from '../../lib/types';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
  meetingRequestsOpen: boolean;
  receivedRequestsVisible: boolean;
}

export default function MeetingReceivedRequests({
  eventId,
  submissionId,
  meetingRequestsOpen,
  receivedRequestsVisible,
}: Props) {
  const [rows, setRows] = useState<ReceivedMeetingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!receivedRequestsVisible) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRows(await loadReceivedMeetingRequests(eventId, submissionId));
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not load received requests');
    } finally {
      setLoading(false);
    }
  }, [eventId, submissionId, receivedRequestsVisible]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => rows.filter((row) => row.response_status === 'pending').length,
    [rows],
  );

  const respond = async (
    row: ReceivedMeetingRequest,
    response: 'accepted' | 'declined',
  ) => {
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      await respondToMeetingRequest(row.id, response);
      setSuccess(
        response === 'accepted'
          ? 'Meeting request accepted. The organizer can now include it in matching.'
          : 'Meeting request declined.',
      );
      await load();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not save your response');
    } finally {
      setBusyId('');
    }
  };

  if (!receivedRequestsVisible) {
    return (
      <section className={styles.card}>
        <h1>Received Requests</h1>
        <p className={styles.hint}>
          Your event organizer has not enabled viewing who requested you. Meeting
          selections and matching still work as usual.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1>Received Requests</h1>
      <p className={styles.lead}>
        Review incoming requests. Accepting expresses mutual interest; the organizer
        still finalizes the schedule.
      </p>
      <p className={styles.statusBanner}>
        <strong>{pendingCount}</strong> request{pendingCount === 1 ? '' : 's'} awaiting your response.
      </p>
      {!meetingRequestsOpen ? (
        <p className={styles.hint}>Responses are currently closed. Saved responses remain visible.</p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}
      {loading ? <p className={styles.hint}>Loading…</p> : null}
      {!loading && rows.length === 0 ? (
        <p className={styles.hint}>You have not received any meeting requests yet.</p>
      ) : null}
      {!loading && rows.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th>From</th>
                <th>Contact</th>
                <th>Interest</th>
                <th>Message</th>
                <th>Status</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.sender_company_name || '—'}</strong>
                    {row.sender_job_title ? <div className={styles.hint}>{row.sender_job_title}</div> : null}
                  </td>
                  <td>
                    {[row.sender_first_name, row.sender_last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td>{interestLevelLabel(row.interest_level)}</td>
                  <td>{row.reason || '—'}</td>
                  <td>
                    <span className={`${styles.statusPill} ${styles[`status${row.response_status}`]}`}>
                      {row.response_status}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={!meetingRequestsOpen || busyId === row.id}
                        onClick={() => void respond(row, 'accepted')}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        disabled={!meetingRequestsOpen || busyId === row.id}
                        onClick={() => void respond(row, 'declined')}
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
