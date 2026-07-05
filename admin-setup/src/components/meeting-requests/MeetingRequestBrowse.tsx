import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { EventMeetingInterestRequest, MeetingInterestLevel } from '../../lib/types';
import {
  createMeetingRequest,
  deleteMeetingRequest,
  loadMeetingRequestTargets,
  loadOwnMeetingRequests,
  nextMeetingRequestPriority,
  requestForTarget,
  type MeetingRequestTarget,
} from '../../lib/meetingRequests';
import MeetingRequestProfileModal, { MeetingRequestAddModal } from './MeetingRequestProfileModal';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
  viewerRole: 'delegate' | 'vendor';
  meetingRequestsOpen: boolean;
  sentPath: string;
}

export default function MeetingRequestBrowse({
  eventId,
  submissionId,
  viewerRole,
  meetingRequestsOpen,
  sentPath,
}: Props) {
  const [targets, setTargets] = useState<MeetingRequestTarget[]>([]);
  const [requests, setRequests] = useState<EventMeetingInterestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [profileTarget, setProfileTarget] = useState<MeetingRequestTarget | null>(null);
  const [addTarget, setAddTarget] = useState<MeetingRequestTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [targetRows, requestRows] = await Promise.all([
        loadMeetingRequestTargets(eventId, submissionId),
        loadOwnMeetingRequests(submissionId),
      ]);
      setTargets(targetRows);
      setRequests(requestRows);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not load meeting options');
    } finally {
      setLoading(false);
    }
  }, [eventId, submissionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => {
      const haystack = [
        t.company_name,
        t.first_name,
        t.last_name,
        t.job_title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [search, targets]);

  const oppositeLabel = viewerRole === 'delegate' ? 'solution providers' : 'delegates';

  if (!meetingRequestsOpen) {
    return (
      <div className={styles.card}>
        <h1>Meeting Requests</h1>
        <p className={styles.hint}>Meeting requests are not open yet. Your event organizer will enable this when matching begins.</p>
      </div>
    );
  }

  const submitRequest = async (interestLevel: MeetingInterestLevel) => {
    if (!addTarget) return;
    setSaving(true);
    setAddError('');
    try {
      await createMeetingRequest({
        eventId,
        submissionId,
        target: addTarget,
        interestLevel,
        nextPriority: nextMeetingRequestPriority(requests),
      });
      setAddTarget(null);
      await reload();
    } catch (e) {
      setAddError(postgrestErrorMessage(e) || 'Could not submit request');
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (!window.confirm('Cancel this meeting request?')) return;
    try {
      await deleteMeetingRequest(requestId);
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not cancel request');
    }
  };

  return (
    <div className={styles.card}>
      <h1>1:1 Meeting Selections</h1>
      <ul className={styles.leadList}>
        <li>Review {oppositeLabel} by clicking each company name to open their profile.</li>
        <li>Click <strong>Request</strong> to ask for a 1:1 meeting, then choose an interest level (Low, Medium, or High).</li>
        <li>Manage sent requests and priority order on the <Link to={sentPath}>Sent</Link> page.</li>
      </ul>
      <p className={styles.statusBanner}>
        You currently have <strong>{requests.length}</strong> outbound request{requests.length === 1 ? '' : 's'}.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder={`Search ${oppositeLabel}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Link to={sentPath}>View sent requests →</Link>
      </div>
      {loading ? <p className={styles.hint}>Loading…</p> : null}
      {!loading && filteredTargets.length === 0 ? (
        <p className={styles.hint}>No approved profiles are available yet.</p>
      ) : null}
      {!loading && filteredTargets.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th aria-label="Logo" />
                <th>Company</th>
                <th>Contact</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTargets.map((target) => {
                const existing = requestForTarget(requests, target.id);
                return (
                  <tr key={target.id}>
                    <td>
                      {target.logo_url ? (
                        <img src={target.logo_url} alt="" className={styles.logoThumb} />
                      ) : null}
                    </td>
                    <td>
                      <button type="button" className={styles.nameBtn} onClick={() => setProfileTarget(target)}>
                        {target.company_name ?? '—'}
                      </button>
                    </td>
                    <td>{[target.first_name, target.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>
                      <div className={styles.actions}>
                        {existing ? (
                          <>
                            <span className={styles.hint}>
                              Requested · {existing.interest_level ?? 'medium'}
                            </span>
                            <button
                              type="button"
                              className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                              onClick={() => void cancelRequest(existing.id)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className={styles.linkBtn} onClick={() => setAddTarget(target)}>
                            Request
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <MeetingRequestProfileModal
        eventId={eventId}
        submissionId={submissionId}
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
      />
      <MeetingRequestAddModal
        target={addTarget}
        saving={saving}
        error={addError}
        onClose={() => {
          setAddTarget(null);
          setAddError('');
        }}
        onSubmit={(level) => void submitRequest(level)}
      />
    </div>
  );
}
