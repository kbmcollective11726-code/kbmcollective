import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { EventMeetingInterestRequest, MeetingInterestLevel } from '../../lib/types';
import {
  createMeetingRequest,
  deleteMeetingRequest,
  formatPortalMatchWhy,
  loadMeetingRequestTargets,
  loadOwnMeetingRequests,
  loadPortalMatchSuggestions,
  nextMeetingRequestPriority,
  requestForTarget,
  updateMeetingRequestInterest,
  updateMeetingRequestPriorities,
  type MeetingRequestTarget,
  type PortalMatchSuggestion,
} from '../../lib/meetingRequests';
import MeetingRequestProfileModal, {
  MeetingRequestAddModal,
  MeetingRequestEditInterestModal,
} from './MeetingRequestProfileModal';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
  viewerRole: 'delegate' | 'vendor';
  meetingRequestsOpen: boolean;
  matchSuggestionsEnabled: boolean;
  sentPath: string;
}

export default function MeetingRequestBrowse({
  eventId,
  submissionId,
  viewerRole,
  meetingRequestsOpen,
  matchSuggestionsEnabled,
  sentPath,
}: Props) {
  const [targets, setTargets] = useState<MeetingRequestTarget[]>([]);
  const [requests, setRequests] = useState<EventMeetingInterestRequest[]>([]);
  const [suggestions, setSuggestions] = useState<PortalMatchSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [profileTarget, setProfileTarget] = useState<MeetingRequestTarget | null>(null);
  const [addTarget, setAddTarget] = useState<MeetingRequestTarget | null>(null);
  const [editRequest, setEditRequest] = useState<EventMeetingInterestRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [rankingBusy, setRankingBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [editError, setEditError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [targetRows, requestRows, suggestionRows] = await Promise.all([
        loadMeetingRequestTargets(eventId, submissionId),
        loadOwnMeetingRequests(submissionId),
        matchSuggestionsEnabled
          ? loadPortalMatchSuggestions(eventId, submissionId, 200)
          : Promise.resolve([] as PortalMatchSuggestion[]),
      ]);
      setTargets(targetRows);
      setRequests(requestRows);
      setSuggestions(suggestionRows);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not load meeting options');
    } finally {
      setLoading(false);
    }
  }, [eventId, submissionId, matchSuggestionsEnabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedRequests = useMemo(
    () => [...requests].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [requests],
  );

  const rankByRequestId = useMemo(() => {
    const map = new Map<string, number>();
    sortedRequests.forEach((row, index) => map.set(row.id, index + 1));
    return map;
  }, [sortedRequests]);

  const scoreByTargetId = useMemo(() => {
    const map = new Map<string, PortalMatchSuggestion>();
    suggestions.forEach((row) => map.set(row.candidate_id, row));
    return map;
  }, [suggestions]);

  const bestMatchTargetId = useMemo(() => {
    if (!matchSuggestionsEnabled || suggestions.length === 0) return null;
    return suggestions[0]?.candidate_id ?? null;
  }, [matchSuggestionsEnabled, suggestions]);

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = targets;
    if (q) {
      rows = targets.filter((t) => {
        const haystack = [t.company_name, t.first_name, t.last_name, t.job_title]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return [...rows].sort((a, b) => {
      const reqA = requestForTarget(requests, a.id);
      const reqB = requestForTarget(requests, b.id);
      const rankA = reqA ? (rankByRequestId.get(reqA.id) ?? 9999) : null;
      const rankB = reqB ? (rankByRequestId.get(reqB.id) ?? 9999) : null;

      // Requested rows first, ordered by rank (#1 at top).
      if (rankA != null && rankB != null) return rankA - rankB;
      if (rankA != null) return -1;
      if (rankB != null) return 1;

      if (matchSuggestionsEnabled) {
        const scoreA = scoreByTargetId.get(a.id)?.score ?? -1;
        const scoreB = scoreByTargetId.get(b.id)?.score ?? -1;
        if (scoreB !== scoreA) return scoreB - scoreA;
      }
      return (a.company_name ?? '').localeCompare(b.company_name ?? '');
    });
  }, [search, targets, requests, rankByRequestId, matchSuggestionsEnabled, scoreByTargetId]);

  const oppositeLabel = viewerRole === 'delegate' ? 'solution providers' : 'delegates';

  if (!meetingRequestsOpen) {
    return (
      <div className={styles.card}>
        <h1>Meeting Requests</h1>
        <p className={styles.hint}>
          Meeting requests are not open yet. Your event organizer will enable this when matching
          begins.
        </p>
      </div>
    );
  }

  const persistRankOrder = async (orderedIds: string[]) => {
    setRankingBusy(true);
    setError('');
    try {
      await updateMeetingRequestPriorities(submissionId, orderedIds);
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update rank');
    } finally {
      setRankingBusy(false);
    }
  };

  const moveRank = async (requestId: string, delta: number) => {
    const index = sortedRequests.findIndex((r) => r.id === requestId);
    if (index < 0) return;
    const next = index + delta;
    if (next < 0 || next >= sortedRequests.length) return;
    const reordered = [...sortedRequests];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(next, 0, item);
    await persistRankOrder(reordered.map((r) => r.id));
  };

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
      const remaining = sortedRequests.filter((r) => r.id !== requestId);
      if (remaining.length > 0) {
        await updateMeetingRequestPriorities(
          submissionId,
          remaining.map((item) => item.id),
        );
      }
      await reload();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not cancel request');
    }
  };

  const saveInterest = async (interestLevel: MeetingInterestLevel) => {
    if (!editRequest) return;
    setSaving(true);
    setEditError('');
    try {
      await updateMeetingRequestInterest(editRequest.id, interestLevel);
      setEditRequest(null);
      await reload();
    } catch (e) {
      setEditError(postgrestErrorMessage(e) || 'Could not update interest');
    } finally {
      setSaving(false);
    }
  };

  const editTargetLabel = editRequest
    ? editRequest.target_company_name ||
      editRequest.target_person_name ||
      'Meeting request'
    : '';

  return (
    <div className={styles.card}>
      <h1>1:1 Meeting Selections</h1>
      <ul className={styles.leadList}>
        <li>Review {oppositeLabel} by clicking each company name to open their profile.</li>
        {matchSuggestionsEnabled ? (
          <li>
            Unrequested rows are sorted by match fit. <strong>Best match</strong> uses your profile
            form — not who has requested you.
          </li>
        ) : null}
        <li>
          Click <strong>Request</strong>, choose interest (Low, Medium, or High), then use the{' '}
          <strong>Rank</strong> column (↑ ↓) so your top pick is <strong>#1</strong>.
        </li>
        <li>
          You can also review sent requests on <Link to={sentPath}>Sent</Link>.
        </li>
      </ul>
      <p className={styles.statusBanner}>
        You currently have <strong>{requests.length}</strong> outbound request
        {requests.length === 1 ? '' : 's'}
        {requests.length > 0 ? '. Requested people appear at the top in rank order.' : '.'}
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
                {matchSuggestionsEnabled ? <th>Suggested match</th> : null}
                <th>Rank</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTargets.map((target) => {
                const existing = requestForTarget(requests, target.id);
                const rank = existing ? rankByRequestId.get(existing.id) : null;
                const match = scoreByTargetId.get(target.id);
                const isBest = !existing && bestMatchTargetId === target.id;
                return (
                  <tr key={target.id} className={isBest ? styles.bestMatchRow : undefined}>
                    <td>
                      {target.logo_url ? (
                        <img src={target.logo_url} alt="" className={styles.logoThumb} />
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.nameBtn}
                        onClick={() => setProfileTarget(target)}
                      >
                        {target.company_name ?? '—'}
                      </button>
                    </td>
                    <td>
                      {[target.first_name, target.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    {matchSuggestionsEnabled ? (
                      <td className={styles.matchCell}>
                        {match ? (
                          <>
                            {isBest ? <span className={styles.bestMatchBadge}>Best match</span> : null}
                            <span className={styles.matchWhy}>
                              {formatPortalMatchWhy(match.score, match.category_overlap)}
                            </span>
                          </>
                        ) : (
                          <span className={styles.hint}>—</span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      {existing && rank != null ? (
                        <div className={styles.rankCell}>
                          <span className={styles.rankBadge}>#{rank}</span>
                          <div className={styles.priorityActions}>
                            <button
                              type="button"
                              className={styles.rankMoveBtn}
                              disabled={rankingBusy || rank <= 1}
                              onClick={() => void moveRank(existing.id, -1)}
                              title="Move up"
                              aria-label={`Move ${target.company_name ?? 'request'} up in rank`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={styles.rankMoveBtn}
                              disabled={rankingBusy || rank >= sortedRequests.length}
                              onClick={() => void moveRank(existing.id, 1)}
                              title="Move down"
                              aria-label={`Move ${target.company_name ?? 'request'} down in rank`}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className={styles.hint}>—</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        {existing ? (
                          <>
                            <span className={styles.hint}>
                              Requested · {existing.interest_level ?? 'medium'}
                            </span>
                            <button
                              type="button"
                              className={styles.linkBtn}
                              onClick={() => {
                                setEditError('');
                                setEditRequest(existing);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                              onClick={() => void cancelRequest(existing.id)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={styles.linkBtn}
                            onClick={() => setAddTarget(target)}
                          >
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
      {editRequest ? (
        <MeetingRequestEditInterestModal
          companyLabel={editTargetLabel}
          initialLevel={editRequest.interest_level ?? 'medium'}
          saving={saving}
          error={editError}
          onClose={() => {
            setEditRequest(null);
            setEditError('');
          }}
          onSubmit={(level) => void saveInterest(level)}
        />
      ) : null}
    </div>
  );
}
