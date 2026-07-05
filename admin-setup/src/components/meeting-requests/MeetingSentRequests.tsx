import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { EventMeetingInterestRequest, MeetingInterestLevel } from '../../lib/types';
import {
  deleteMeetingRequest,
  displayTargetName,
  interestLevelLabel,
  loadMeetingRequestTargetProfile,
  loadOwnMeetingRequests,
  updateMeetingRequestInterest,
  updateMeetingRequestPriorities,
} from '../../lib/meetingRequests';
import MeetingRequestProfileModal, { MeetingRequestEditInterestModal } from './MeetingRequestProfileModal';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
  meetingRequestsOpen: boolean;
  requestPath: string;
}

export default function MeetingSentRequests({
  eventId,
  submissionId,
  meetingRequestsOpen,
  requestPath,
}: Props) {
  const [rows, setRows] = useState<EventMeetingInterestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<{
    id: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    logo_url: string | null;
  } | null>(null);
  const [editRow, setEditRow] = useState<EventMeetingInterestRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await loadOwnMeetingRequests(submissionId);
      setRows(data);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not load sent requests');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!profileTargetId) {
      setProfileTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const profile = await loadMeetingRequestTargetProfile(eventId, submissionId, profileTargetId);
        if (!cancelled) {
          setProfileTarget({
            id: profile.id,
            company_name: profile.company_name,
            first_name: profile.first_name,
            last_name: profile.last_name,
            logo_url: profile.answers.find((a) => a.prompt.toLowerCase().includes('company logo'))?.value ?? null,
          });
        }
      } catch {
        if (!cancelled) setProfileTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, profileTargetId, submissionId]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [rows],
  );

  if (!meetingRequestsOpen) {
    return (
      <div className={styles.card}>
        <h1>Sent Requests</h1>
        <p className={styles.hint}>Meeting requests are not open yet.</p>
      </div>
    );
  }

  const moveToTop = async (row: EventMeetingInterestRequest) => {
    const others = sortedRows.filter((r) => r.id !== row.id);
    const next = [{ id: row.id, priority: 0 }, ...others.map((r, idx) => ({ id: r.id, priority: idx + 1 }))];
    try {
      await updateMeetingRequestPriorities(next);
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update rank');
    }
  };

  const updateRank = async (rowId: string, rank: number) => {
    const clamped = Math.max(1, Math.min(sortedRows.length, rank));
    const currentIndex = sortedRows.findIndex((r) => r.id === rowId);
    if (currentIndex < 0) return;
    const reordered = [...sortedRows];
    const [item] = reordered.splice(currentIndex, 1);
    if (!item) return;
    reordered.splice(clamped - 1, 0, item);
    try {
      await updateMeetingRequestPriorities(reordered.map((r, idx) => ({ id: r.id, priority: idx })));
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update rank');
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (!window.confirm('Cancel this meeting request?')) return;
    try {
      await deleteMeetingRequest(requestId);
      const remaining = sortedRows.filter((r) => r.id !== requestId);
      await updateMeetingRequestPriorities(remaining.map((r, idx) => ({ id: r.id, priority: idx })));
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not cancel request');
    }
  };

  const saveInterest = async (interestLevel: MeetingInterestLevel) => {
    if (!editRow) return;
    setSaving(true);
    setEditError('');
    try {
      await updateMeetingRequestInterest(editRow.id, interestLevel);
      setEditRow(null);
      await reload();
    } catch (e) {
      setEditError(postgrestErrorMessage(e) || 'Could not update interest');
    } finally {
      setSaving(false);
    }
  };

  const interestClass = (level: MeetingInterestLevel | null | undefined) => {
    if (level === 'high') return styles.interestBadgeHigh;
    if (level === 'low') return styles.interestBadgeLow;
    return styles.interestBadgeMedium;
  };

  return (
    <div className={styles.card}>
      <h1>Sent Requests</h1>
      <ul className={styles.leadList}>
        <li>Rank your sent requests in priority order — highest-ranked targets are scheduled first.</li>
        <li>Update interest level (Low, Medium, High) to reflect how strongly you want each meeting.</li>
      </ul>
      <p className={styles.toolbar}>
        <Link to={requestPath}>← Back to meeting selections</Link>
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.hint}>Loading…</p> : null}
      {!loading && sortedRows.length === 0 ? (
        <p className={styles.hint}>
          You have not submitted any meeting requests yet.{' '}
          <Link to={requestPath}>Browse {`participants`}</Link>.
        </p>
      ) : null}
      {!loading && sortedRows.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Date</th>
                <th>Interest Level</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <div className={styles.actions}>
                      <input
                        className={styles.rankInput}
                        type="number"
                        min={1}
                        max={sortedRows.length}
                        value={index + 1}
                        onChange={(e) => void updateRank(row.id, Number(e.target.value))}
                      />
                      {index > 0 ? (
                        <button type="button" className={styles.linkBtn} onClick={() => void moveToTop(row)}>
                          TOP
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {row.target_submission_id ? (
                      <button
                        type="button"
                        className={styles.nameBtn}
                        onClick={() => setProfileTargetId(row.target_submission_id)}
                      >
                        {row.target_company_name ?? '—'}
                      </button>
                    ) : (
                      row.target_company_name ?? '—'
                    )}
                  </td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={`${styles.linkBtn} ${interestClass(row.interest_level)}`}
                      onClick={() => setEditRow(row)}
                    >
                      {interestLevelLabel(row.interest_level)}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                      onClick={() => void cancelRequest(row.id)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <MeetingRequestProfileModal
        eventId={eventId}
        submissionId={submissionId}
        target={
          profileTarget
            ? {
                id: profileTarget.id,
                company_name: profileTarget.company_name,
                first_name: profileTarget.first_name,
                last_name: profileTarget.last_name,
                job_title: null,
                attendee_type: '',
                logo_url: profileTarget.logo_url,
              }
            : null
        }
        onClose={() => {
          setProfileTargetId(null);
          setProfileTarget(null);
        }}
      />
      {editRow ? (
        <MeetingRequestEditInterestModal
          companyLabel={displayTargetName({
            company_name: editRow.target_company_name,
            first_name: editRow.target_person_name?.split(' ')[0] ?? null,
            last_name: editRow.target_person_name?.split(' ').slice(1).join(' ') ?? null,
          })}
          initialLevel={editRow.interest_level ?? 'medium'}
          saving={saving}
          error={editError}
          onClose={() => {
            setEditRow(null);
            setEditError('');
          }}
          onSubmit={(level) => void saveInterest(level)}
        />
      ) : null}
    </div>
  );
}
