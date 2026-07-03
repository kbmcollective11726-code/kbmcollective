import { useEffect, useMemo, useState } from 'react';
import MemberSearchSelect, { type MemberPickOption } from './MemberSearchSelect';
import { supabase } from '../lib/supabase';
import { transferEventMeetings, transferMeetingsErrorMessage } from '../lib/transferEventMeetings';
import styles from '../pages/Members.module.css';

type SourceMember = {
  user_id: string;
  full_name: string;
  email: string;
};

export default function TransferMeetingsModal({
  eventId,
  source,
  memberOptions,
  onClose,
  onDone,
}: {
  eventId: string;
  source: SourceMember;
  memberOptions: MemberPickOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [willMove, setWillMove] = useState<number | null>(null);
  const [skippedConflict, setSkippedConflict] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string | null>(null);

  const selectableMembers = useMemo(
    () => memberOptions.filter((m) => m.user_id !== source.user_id),
    [memberOptions, source.user_id]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcErr } = await supabase.rpc('admin_count_event_meetings_for_user', {
        p_event_id: eventId,
        p_user_id: source.user_id,
      });
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message);
        setSourceCount(null);
      } else {
        const row = data as { meeting_count?: number; error?: string } | null;
        if (row?.error) {
          setError(transferMeetingsErrorMessage(String(row.error)));
          setSourceCount(null);
        } else {
          setSourceCount(typeof row?.meeting_count === 'number' ? row.meeting_count : 0);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, source.user_id]);

  useEffect(() => {
    if (!targetId) {
      setWillMove(null);
      setSkippedConflict(0);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await transferEventMeetings({
        eventId,
        fromUserId: source.user_id,
        toUserId: targetId,
        dryRun: true,
      });
      if (cancelled) return;
      if (res.error) {
        setError(transferMeetingsErrorMessage(res.error));
        setWillMove(null);
        setSkippedConflict(0);
      } else {
        setError(null);
        setWillMove(res.transferred ?? 0);
        setSkippedConflict(res.skipped_conflict ?? 0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, source.user_id, targetId]);

  const handleTransfer = async () => {
    if (!targetId) {
      setError('Select the member who should receive these meetings.');
      return;
    }
    const n = willMove ?? 0;
    if (n <= 0) {
      setError('There are no active meetings to transfer for this member.');
      return;
    }
    const targetLabel =
      selectableMembers.find((m) => m.user_id === targetId)?.user?.full_name?.trim() ||
      selectableMembers.find((m) => m.user_id === targetId)?.user?.email?.trim() ||
      'the selected member';
    const ok = window.confirm(
      `Move ${n} meeting${n === 1 ? '' : 's'} from ${source.full_name || source.email} to ${targetLabel}?`
    );
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    const res = await transferEventMeetings({
      eventId,
      fromUserId: source.user_id,
      toUserId: targetId,
      dryRun: false,
    });
    setSubmitting(false);
    if (res.error) {
      setError(transferMeetingsErrorMessage(res.error));
      return;
    }
    const moved = res.transferred ?? 0;
    const skipped = res.skipped_conflict ?? 0;
    let msg = `Moved ${moved} meeting${moved === 1 ? '' : 's'}.`;
    if (skipped > 0) {
      msg += ` ${skipped} skipped (target already had that time slot).`;
    }
    setResultSummary(msg);
    onDone();
  };

  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-labelledby="transfer-meetings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="transfer-meetings-title" className={styles.modalTitle}>
          Transfer B2B meetings
        </h2>
        <p className={styles.modalHint}>
          Move all active 1:1 booth meetings from{' '}
          <strong>{source.full_name || source.email}</strong> ({source.email}) to another member on
          this event. Use when someone signed in with a duplicate account.
        </p>

        {resultSummary ? (
          <p className={styles.transferSuccess}>{resultSummary}</p>
        ) : (
          <>
            {sourceCount != null && !targetId ? (
              <p className={styles.modalHint}>
                {sourceCount === 0
                  ? 'This member has no active meetings on this event.'
                  : `${sourceCount} active meeting${sourceCount === 1 ? '' : 's'} on this event.`}
              </p>
            ) : null}

            <label className={styles.modalLabel}>
              Transfer to
              <MemberSearchSelect
                members={selectableMembers}
                value={targetId}
                onChange={setTargetId}
                placeholder="Search member by name or email…"
                ariaLabel="Transfer meetings to member"
              />
            </label>

            {loading && targetId ? <p className={styles.modalHint}>Checking meetings…</p> : null}
            {!loading && targetId && willMove != null ? (
              <p className={styles.modalHint}>
                {willMove === 0
                  ? 'No meetings will move (target may already have those slots).'
                  : `${willMove} meeting${willMove === 1 ? '' : 's'} will move${
                      skippedConflict > 0
                        ? ` (${skippedConflict} skipped — target already booked that slot)`
                        : ''
                    }.`}
              </p>
            ) : null}

            {error ? <p className={styles.modalError}>{error}</p> : null}
          </>
        )}

        <div className={styles.modalActions}>
          <button type="button" className={styles.modalBtnSecondary} onClick={onClose} disabled={submitting}>
            {resultSummary ? 'Close' : 'Cancel'}
          </button>
          {!resultSummary ? (
            <button
              type="button"
              className={styles.modalBtnPrimary}
              onClick={() => void handleTransfer()}
              disabled={submitting || loading || !targetId || (willMove ?? 0) <= 0}
            >
              {submitting ? 'Transferring…' : 'Transfer meetings'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
