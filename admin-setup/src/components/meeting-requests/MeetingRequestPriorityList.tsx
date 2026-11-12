import { useMemo, useState } from 'react';
import type { EventMeetingInterestRequest } from '../../lib/types';
import { interestLevelLabel, updateMeetingRequestPriorities } from '../../lib/meetingRequests';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import styles from './MeetingRequests.module.css';

interface Props {
  submissionId: string;
  requests: EventMeetingInterestRequest[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  /** Compact list under browse, or full Sent table controls */
  variant?: 'panel' | 'inline';
}

/**
 * Drag (or ↑ ↓ Top) to set meeting priority. Top of list = #1 for matchmaking.
 */
export default function MeetingRequestPriorityList({
  submissionId,
  requests,
  onChanged,
  onError,
  variant = 'panel',
}: Props) {
  const sorted = useMemo(
    () => [...requests].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [requests],
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (sorted.length === 0) return null;

  const persistOrder = async (orderedIds: string[]) => {
    setSaving(true);
    onError('');
    try {
      await updateMeetingRequestPriorities(submissionId, orderedIds);
      await onChanged();
    } catch (e) {
      onError(postgrestErrorMessage(e) || 'Could not update priority order');
    } finally {
      setSaving(false);
      setDragId(null);
      setOverId(null);
    }
  };

  const moveRelative = async (requestId: string, delta: number) => {
    const index = sorted.findIndex((r) => r.id === requestId);
    if (index < 0) return;
    const next = index + delta;
    if (next < 0 || next >= sorted.length) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(next, 0, item);
    await persistOrder(reordered.map((r) => r.id));
  };

  const moveToTop = async (requestId: string) => {
    const rest = sorted.filter((r) => r.id !== requestId);
    await persistOrder([requestId, ...rest.map((r) => r.id)]);
  };

  const onDropOn = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = sorted.findIndex((r) => r.id === dragId);
    const to = sorted.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(from, 1);
    if (!item) return;
    reordered.splice(to, 0, item);
    await persistOrder(reordered.map((r) => r.id));
  };

  const labelFor = (row: EventMeetingInterestRequest) =>
    row.target_company_name ||
    row.target_person_name ||
    'Meeting request';

  return (
    <div className={variant === 'panel' ? styles.priorityPanel : undefined}>
      {variant === 'panel' ? (
        <>
          <h2 className={styles.priorityTitle}>Your meeting priority</h2>
          <p className={styles.priorityLead}>
            Drag a row or use the buttons to set order. Whoever is on top is <strong>#1</strong> —
            organizers schedule highest priority first.
          </p>
        </>
      ) : null}
      <ol className={styles.priorityList} aria-label="Meeting request priority order">
        {sorted.map((row, index) => {
          const isDragging = dragId === row.id;
          const isOver = overId === row.id && dragId && dragId !== row.id;
          return (
            <li
              key={row.id}
              className={[
                styles.priorityItem,
                isDragging ? styles.priorityItemDragging : '',
                isOver ? styles.priorityItemOver : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable={!saving}
              onDragStart={(e) => {
                setDragId(row.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== row.id) setOverId(row.id);
              }}
              onDragLeave={() => {
                if (overId === row.id) setOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void onDropOn(row.id);
              }}
            >
              <span className={styles.priorityHandle} title="Drag to reorder" aria-hidden>
                ⋮⋮
              </span>
              <span className={styles.priorityRank} aria-label={`Rank ${index + 1}`}>
                #{index + 1}
              </span>
              <div className={styles.priorityMain}>
                <strong>{labelFor(row)}</strong>
                <span className={styles.hint}>
                  {interestLevelLabel(row.interest_level)} interest
                  {row.target_person_name && row.target_company_name
                    ? ` · ${row.target_person_name}`
                    : ''}
                </span>
              </div>
              <div className={styles.priorityActions}>
                <button
                  type="button"
                  className={styles.rankMoveBtn}
                  disabled={saving || index === 0}
                  onClick={() => void moveRelative(row.id, -1)}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.rankMoveBtn}
                  disabled={saving || index === sorted.length - 1}
                  onClick={() => void moveRelative(row.id, 1)}
                  title="Move down"
                >
                  ↓
                </button>
                {index > 0 ? (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    disabled={saving}
                    onClick={() => void moveToTop(row.id)}
                  >
                    Top
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
