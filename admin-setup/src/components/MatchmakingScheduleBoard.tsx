import { useMemo, useState } from 'react';
import {
  buildUnscheduledQueue,
  formatMeetingPairDisplay,
  formatSlotDayLabel,
  formatSlotTimeOnly,
  isMutualHighInterest,
  slotDayKey,
  submissionLabel,
  type UnscheduledQueueItem,
} from '../lib/matchmakingScheduleQueue';
import { homeTableForVendor } from '../lib/matchmakingAutoSchedule';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { supabase } from '../lib/supabase';
import type {
  EventMatchScheduledMeeting,
  EventMatchmakingLocation,
  EventMatchmakingTimeSlot,
  EventMatchReview,
  EventMeetingInterestRequest,
  EventRegistrationSubmission,
} from '../lib/types';
import styles from '../pages/EventMatchmaking.module.css';

type BatchMoveItem = {
  meeting_id: string;
  label: string;
  reason?: string;
  location?: string | null;
};

type BatchMoveReport = {
  total: number;
  moved_count: number;
  skipped_count: number;
  moved: BatchMoveItem[];
  skipped: BatchMoveItem[];
};

interface Props {
  eventId: string;
  submissions: EventRegistrationSubmission[];
  meetingRequests: EventMeetingInterestRequest[];
  unscheduledReviews: EventMatchReview[];
  scheduledMeetings: EventMatchScheduledMeeting[];
  timeSlots: EventMatchmakingTimeSlot[];
  locations: EventMatchmakingLocation[];
  locationId: string;
  onLocationIdChange: (id: string) => void;
  actionId: string;
  publishingMeetingId: string;
  onSchedule: (review: EventMatchReview, timeSlotId: string, locationId: string) => Promise<void>;
  onReschedule: (
    meeting: EventMatchScheduledMeeting,
    timeSlotId: string,
    locationId: string,
    notes?: string | null,
  ) => Promise<void>;
  onCancel: (meeting: EventMatchScheduledMeeting) => Promise<void>;
  onPublish: (meetingId: string) => Promise<void>;
  onPublishAll: (meetingIds: string[]) => Promise<void>;
  onExportCsv: () => void;
  onGoToMatching: () => void;
  onChanged?: () => void | Promise<void>;
}

function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'success' | 'warn' | 'muted' | 'danger' | 'info';
}) {
  return <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{label}</span>;
}

function isPublished(m: EventMatchScheduledMeeting): boolean {
  return Boolean(m.published_to_app_at && m.app_booking_id);
}

export default function MatchmakingScheduleBoard({
  eventId,
  submissions,
  meetingRequests,
  unscheduledReviews,
  scheduledMeetings,
  timeSlots,
  locations,
  locationId,
  onLocationIdChange,
  actionId,
  publishingMeetingId,
  onSchedule,
  onReschedule,
  onCancel,
  onPublish,
  onPublishAll,
  onExportCsv,
  onGoToMatching,
  onChanged,
}: Props) {
  const [vendorFilterId, setVendorFilterId] = useState('');
  const [dayKey, setDayKey] = useState<string>('');
  const [editingMeetingId, setEditingMeetingId] = useState('');
  const [editSlotId, setEditSlotId] = useState('');
  const [editLocationId, setEditLocationId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [placingReviewId, setPlacingReviewId] = useState('');
  const [placeSlotId, setPlaceSlotId] = useState('');
  const [placeLocationId, setPlaceLocationId] = useState('');
  const [placeBusy, setPlaceBusy] = useState(false);
  const [batchFromSlotId, setBatchFromSlotId] = useState('');
  const [batchToSlotId, setBatchToSlotId] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchNotice, setBatchNotice] = useState('');
  const [batchReport, setBatchReport] = useState<BatchMoveReport | null>(null);

  const submissionById = useMemo(() => new Map(submissions.map((s) => [s.id, s])), [submissions]);

  const vendors = useMemo(
    () =>
      submissions
        .filter((s) => s.attendee_type === 'vendor')
        .sort((a, b) =>
          (a.company_name || submissionLabel(a)).localeCompare(b.company_name || submissionLabel(b)),
        ),
    [submissions],
  );

  const involvesVendor = (aId: string, bId: string) => {
    if (!vendorFilterId) return true;
    return aId === vendorFilterId || bId === vendorFilterId;
  };

  const queue = useMemo(
    () =>
      buildUnscheduledQueue({
        reviews: unscheduledReviews,
        submissions,
        meetingRequests,
      }).filter((item) => involvesVendor(item.from.id, item.to.id)),
    [unscheduledReviews, submissions, meetingRequests, vendorFilterId],
  );

  const filteredScheduled = useMemo(
    () =>
      scheduledMeetings
        .filter((m) => m.status === 'scheduled')
        .filter((m) => involvesVendor(m.submission_a_id, m.submission_b_id)),
    [scheduledMeetings, vendorFilterId],
  );

  const dayKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of timeSlots) keys.add(slotDayKey(slot.start_time));
    for (const m of filteredScheduled) {
      if (m.start_time) keys.add(slotDayKey(m.start_time));
    }
    return Array.from(keys).filter(Boolean).sort();
  }, [timeSlots, filteredScheduled]);

  const activeDay = dayKey && dayKeys.includes(dayKey) ? dayKey : (dayKeys[0] ?? '');

  const dayMeetings = useMemo(() => {
    if (!activeDay) return [] as EventMatchScheduledMeeting[];
    return filteredScheduled
      .filter((m) => slotDayKey(m.start_time) === activeDay)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [filteredScheduled, activeDay]);

  const unpublishedOnDay = useMemo(
    () => dayMeetings.filter((m) => !isPublished(m)).map((m) => m.id),
    [dayMeetings],
  );

  const publishedOnDay = dayMeetings.length - unpublishedOnDay.length;

  const daySlots = useMemo(
    () =>
      timeSlots
        .filter((slot) => slot.is_active !== false && slotDayKey(slot.start_time) === activeDay)
        .sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [timeSlots, activeDay],
  );

  const vendorIdFromPair = (aId: string, bId: string): string | null => {
    const a = submissionById.get(aId);
    const b = submissionById.get(bId);
    if (a?.attendee_type === 'vendor') return a.id;
    if (b?.attendee_type === 'vendor') return b.id;
    return null;
  };

  const openEditMeeting = (meeting: EventMatchScheduledMeeting) => {
    setEditingMeetingId(meeting.id);
    const vendorId = vendorIdFromPair(meeting.submission_a_id, meeting.submission_b_id);
    const home = vendorId ? homeTableForVendor(locations, vendorId) : null;
    setEditSlotId(meeting.time_slot_id ?? '');
    setEditLocationId(meeting.location_id || home?.id || locationId || '');
    setEditNotes(meeting.notes ?? '');
  };

  const closeEditMeeting = () => {
    setEditingMeetingId('');
    setEditSlotId('');
    setEditLocationId('');
    setEditNotes('');
    setEditSaving(false);
  };

  const saveEditMeeting = async () => {
    const meeting = scheduledMeetings.find((m) => m.id === editingMeetingId);
    if (!meeting || !editSlotId || !editLocationId) return;
    setEditSaving(true);
    try {
      await onReschedule(meeting, editSlotId, editLocationId, editNotes.trim() || null);
      closeEditMeeting();
    } finally {
      setEditSaving(false);
    }
  };

  const startPlace = (item: UnscheduledQueueItem) => {
    const vendorId = vendorIdFromPair(item.from.id, item.to.id);
    const home = vendorId ? homeTableForVendor(locations, vendorId) : null;
    setPlacingReviewId(item.review.id);
    setPlaceSlotId(daySlots[0]?.id ?? '');
    setPlaceLocationId(home?.id || locationId || locations.find((l) => l.is_active !== false)?.id || '');
  };

  const confirmPlace = async () => {
    const item = queue.find((q) => q.review.id === placingReviewId);
    if (!item || !placeSlotId || !placeLocationId) return;
    setPlaceBusy(true);
    try {
      await onSchedule(item.review, placeSlotId, placeLocationId);
      setPlacingReviewId('');
      setPlaceSlotId('');
      setPlaceLocationId('');
    } finally {
      setPlaceBusy(false);
    }
  };

  const slotMeetingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const meeting of scheduledMeetings) {
      if (meeting.status !== 'scheduled' || !meeting.time_slot_id) continue;
      counts[meeting.time_slot_id] = (counts[meeting.time_slot_id] ?? 0) + 1;
    }
    return counts;
  }, [scheduledMeetings]);

  const slotSelectLabel = (slot: EventMatchmakingTimeSlot) => {
    const count = slotMeetingCounts[slot.id] ?? 0;
    const time = formatSlotTimeOnly(slot.start_time, slot.end_time);
    return count > 0 ? `${time} · ${count} mtg` : time;
  };

  const runBatchMove = async () => {
    if (!batchFromSlotId || !batchToSlotId || batchFromSlotId === batchToSlotId) {
      setBatchError('Choose two different slots on this day.');
      return;
    }
    const fromCount = slotMeetingCounts[batchFromSlotId] ?? 0;
    if (fromCount === 0) {
      setBatchError('The source slot has no meetings.');
      return;
    }
    if (
      !window.confirm(
        `Move ${fromCount} meeting${fromCount === 1 ? '' : 's'} to the new time? Tables stay the same.`,
      )
    ) {
      return;
    }
    setBatchBusy(true);
    setBatchError('');
    setBatchNotice('');
    setBatchReport(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('batch_reschedule_matchmaking_slot', {
        p_event_id: eventId,
        p_from_slot_id: batchFromSlotId,
        p_to_slot_id: batchToSlotId,
        p_override_availability: false,
      });
      if (rpcError) throw rpcError;
      const report = data as BatchMoveReport;
      setBatchReport({
        total: report.total ?? 0,
        moved_count: report.moved_count ?? 0,
        skipped_count: report.skipped_count ?? 0,
        moved: Array.isArray(report.moved) ? report.moved : [],
        skipped: Array.isArray(report.skipped) ? report.skipped : [],
      });
      setBatchNotice(
        `Moved ${report.moved_count ?? 0} of ${report.total ?? 0}.` +
          ((report.skipped_count ?? 0) > 0 ? ` Skipped ${report.skipped_count}.` : ''),
      );
      await onChanged?.();
    } catch (cause) {
      setBatchError(postgrestErrorMessage(cause) || 'Could not move meetings');
    } finally {
      setBatchBusy(false);
    }
  };

  const selectedVendor = vendors.find((v) => v.id === vendorFilterId) ?? null;
  const busyPublish = publishingMeetingId !== '';

  return (
    <div className={styles.reviewPublish}>
      <div className={styles.reviewPublishSummary}>
        <div className={styles.reviewStat}>
          <strong>{dayMeetings.length}</strong>
          <span>on this day</span>
        </div>
        <div className={styles.reviewStat}>
          <strong>{unpublishedOnDay.length}</strong>
          <span>ready to publish</span>
        </div>
        <div className={styles.reviewStat}>
          <strong>{publishedOnDay}</strong>
          <span>published</span>
        </div>
        <div className={styles.reviewStat}>
          <strong>{queue.length}</strong>
          <span>need a time slot</span>
        </div>
      </div>

      <div className={styles.reviewPublishToolbar}>
        <div className={styles.reviewDayTabs} role="tablist" aria-label="Meeting day">
          {dayKeys.length === 0 ? (
            <span className={styles.hint}>No meeting days yet — add slots first.</span>
          ) : (
            dayKeys.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === activeDay}
                className={
                  key === activeDay ? styles.reviewDayTabActive : styles.reviewDayTab
                }
                onClick={() => setDayKey(key)}
              >
                {formatSlotDayLabel(key)}
              </button>
            ))
          )}
        </div>
        <label className={styles.field}>
          <span>Vendor</span>
          <select
            value={vendorFilterId}
            onChange={(e) => setVendorFilterId(e.target.value)}
          >
            <option value="">All vendors</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {(vendor.company_name || 'Vendor') + ' · ' + submissionLabel(vendor)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={unpublishedOnDay.length === 0 || busyPublish || actionId !== ''}
            title={
              unpublishedOnDay.length === 0
                ? activeDay
                  ? `Nothing left to publish on ${formatSlotDayLabel(activeDay)}`
                  : 'Nothing left to publish'
                : `Publish ${unpublishedOnDay.length} unpublished meeting${
                    unpublishedOnDay.length === 1 ? '' : 's'
                  } on this day`
            }
            onClick={() => void onPublishAll(unpublishedOnDay)}
          >
            {publishingMeetingId === '__all__'
              ? 'Publishing…'
              : unpublishedOnDay.length > 0
                ? `Publish day to app (${unpublishedOnDay.length})`
                : 'All published for this day'}
          </button>
          <button type="button" className={styles.btnSecondary} onClick={onExportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {selectedVendor ? (
        <p className={styles.hint}>
          Showing <strong>{selectedVendor.company_name || submissionLabel(selectedVendor)}</strong>
          {activeDay ? <> · {formatSlotDayLabel(activeDay)}</> : null}
        </p>
      ) : activeDay ? (
        <p className={styles.hint}>Showing {formatSlotDayLabel(activeDay)}</p>
      ) : null}

      <section className={styles.reviewListSection}>
        <div className={styles.setupPanelHeader}>
          <h3>Schedule</h3>
          <Badge
            label={`${dayMeetings.length} meeting${dayMeetings.length === 1 ? '' : 's'}`}
            tone="info"
          />
        </div>

        {dayMeetings.length === 0 ? (
          <p className={styles.setupEmpty}>
            No scheduled meetings for this day
            {selectedVendor ? ' and vendor' : ''}.{' '}
            {queue.length > 0 ? (
              <>Place pairings below, or go back to Approve and schedule.</>
            ) : (
              <button type="button" className={styles.tabLink} onClick={onGoToMatching}>
                Approve and schedule
              </button>
            )}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Meeting</th>
                  <th>Table</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dayMeetings.map((meeting) => {
                  const a = submissionById.get(meeting.submission_a_id);
                  const b = submissionById.get(meeting.submission_b_id);
                  const pair = formatMeetingPairDisplay(a, b);
                  const mutual = isMutualHighInterest(
                    meeting.submission_a_id,
                    meeting.submission_b_id,
                    meetingRequests,
                  );
                  const published = isPublished(meeting);
                  const editing = editingMeetingId === meeting.id;
                  const activeSlots = timeSlots.filter((s) => s.is_active !== false);
                  const slotsThisDay = activeSlots.filter(
                    (s) => slotDayKey(s.start_time) === activeDay,
                  );
                  const slotsOtherDays = activeSlots.filter(
                    (s) => slotDayKey(s.start_time) !== activeDay,
                  );
                  return (
                    <tr
                      key={meeting.id}
                      className={editing ? styles.reviewRowEditing : undefined}
                    >
                      <td>
                        {editing ? (
                          <select
                            className={styles.reviewInlineSelect}
                            value={editSlotId}
                            disabled={editSaving}
                            onChange={(e) => setEditSlotId(e.target.value)}
                            aria-label="Meeting time"
                          >
                            <option value="">Time…</option>
                            {slotsThisDay.map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {formatSlotTimeOnly(slot.start_time, slot.end_time)}
                              </option>
                            ))}
                            {slotsOtherDays.length > 0 ? (
                              <optgroup label="Other days">
                                {slotsOtherDays.map((slot) => (
                                  <option key={slot.id} value={slot.id}>
                                    {formatSlotDayLabel(slotDayKey(slot.start_time))} ·{' '}
                                    {formatSlotTimeOnly(slot.start_time, slot.end_time)}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                          </select>
                        ) : (
                          <strong>
                            {formatSlotTimeOnly(meeting.start_time, meeting.end_time)}
                          </strong>
                        )}
                      </td>
                      <td>
                        <div className={styles.scheduleQueueItemTop}>
                          <strong>{pair.title}</strong>
                          {mutual ? <Badge label="Mutual" tone="success" /> : null}
                        </div>
                        <div className={styles.scheduleQueueMeta}>{pair.repsLine}</div>
                        {editing ? (
                          <input
                            className={styles.reviewInlineNotes}
                            value={editNotes}
                            disabled={editSaving}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            aria-label="Meeting notes"
                          />
                        ) : meeting.notes ? (
                          <div className={styles.scheduleQueueMeta}>{meeting.notes}</div>
                        ) : null}
                      </td>
                      <td>
                        {editing ? (
                          <select
                            className={styles.reviewInlineSelect}
                            value={editLocationId}
                            disabled={editSaving}
                            onChange={(e) => setEditLocationId(e.target.value)}
                            aria-label="Meeting table"
                          >
                            <option value="">Table…</option>
                            {locations
                              .filter((l) => l.is_active !== false)
                              .map((location) => (
                                <option key={location.id} value={location.id}>
                                  {location.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          meeting.location || '—'
                        )}
                      </td>
                      <td>
                        {published ? (
                          <Badge label="Published" tone="success" />
                        ) : (
                          <Badge label="Ready" tone="warn" />
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <div className={styles.toolbarActions}>
                            <button
                              type="button"
                              className={styles.btnPrimary}
                              disabled={editSaving || !editSlotId || !editLocationId}
                              onClick={() => void saveEditMeeting()}
                            >
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              disabled={editSaving}
                              onClick={closeEditMeeting}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className={styles.toolbarActions}>
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              disabled={busyPublish || Boolean(editingMeetingId)}
                              onClick={() => openEditMeeting(meeting)}
                            >
                              Edit
                            </button>
                            {published ? null : (
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                disabled={
                                  busyPublish ||
                                  publishingMeetingId === meeting.id ||
                                  actionId === meeting.id ||
                                  Boolean(editingMeetingId)
                                }
                                onClick={() => void onPublish(meeting.id)}
                              >
                                {publishingMeetingId === meeting.id
                                  ? 'Publishing…'
                                  : 'Publish'}
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.btnDangerOutline}
                              disabled={
                                actionId === meeting.id ||
                                busyPublish ||
                                Boolean(editingMeetingId)
                              }
                              onClick={() => void onCancel(meeting)}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {queue.length > 0 ? (
        <section className={styles.reviewListSection}>
          <div className={styles.setupPanelHeader}>
            <h3>Need a time slot</h3>
            <Badge label={`${queue.length}`} tone="warn" />
          </div>
          <p className={styles.hint}>
            Approved matches that are not on the board yet. Place them, then publish.
          </p>
          <ul className={styles.reviewNeedSlotList}>
            {queue.map((item) => {
              const pair = formatMeetingPairDisplay(item.from, item.to);
              const placing = placingReviewId === item.review.id;
              const vendorId = vendorIdFromPair(item.from.id, item.to.id);
              const home = vendorId ? homeTableForVendor(locations, vendorId) : null;
              return (
                <li key={item.review.id} className={styles.reviewNeedSlotRow}>
                  <div>
                    <strong>{pair.title}</strong>
                    <div className={styles.scheduleQueueMeta}>{pair.repsLine}</div>
                    {home ? (
                      <div className={styles.scheduleQueueMeta}>Home table: {home.name}</div>
                    ) : null}
                  </div>
                  {placing ? (
                    <div className={styles.reviewPlaceRow}>
                      <select
                        value={placeSlotId}
                        onChange={(e) => setPlaceSlotId(e.target.value)}
                        disabled={placeBusy}
                      >
                        <option value="">Time…</option>
                        {daySlots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slotSelectLabel(slot)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={placeLocationId}
                        onChange={(e) => {
                          setPlaceLocationId(e.target.value);
                          onLocationIdChange(e.target.value);
                        }}
                        disabled={placeBusy}
                      >
                        <option value="">Table…</option>
                        {locations
                          .filter((l) => l.is_active !== false)
                          .map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        disabled={placeBusy || !placeSlotId || !placeLocationId}
                        onClick={() => void confirmPlace()}
                      >
                        {placeBusy ? 'Placing…' : 'Place'}
                      </button>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={placeBusy}
                        onClick={() => setPlacingReviewId('')}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => startPlace(item)}
                    >
                      Place on day
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <details className={styles.reviewAdvanced}>
        <summary>Advanced — batch move times on this day</summary>
        <p className={styles.setupPanelHint}>
          Shift every meeting in one slot to another. Tables stay the same. Conflicts are skipped.
        </p>
        {batchError ? <p className={styles.error}>{batchError}</p> : null}
        {batchNotice ? <p className={styles.success}>{batchNotice}</p> : null}
        <div className={styles.setupFormRow}>
          <label className={styles.field}>
            <span>From</span>
            <select
              value={batchFromSlotId}
              onChange={(e) => {
                setBatchFromSlotId(e.target.value);
                setBatchReport(null);
                setBatchError('');
              }}
            >
              <option value="">Select…</option>
              {daySlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slotSelectLabel(slot)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>To</span>
            <select
              value={batchToSlotId}
              onChange={(e) => {
                setBatchToSlotId(e.target.value);
                setBatchReport(null);
                setBatchError('');
              }}
            >
              <option value="">Select…</option>
              {daySlots
                .filter((s) => s.id !== batchFromSlotId)
                .map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slotSelectLabel(slot)}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={batchBusy || !batchFromSlotId || !batchToSlotId}
            onClick={() => void runBatchMove()}
          >
            {batchBusy ? 'Moving…' : 'Move meetings'}
          </button>
        </div>
        {batchReport ? (
          <p className={styles.hint}>
            Moved {batchReport.moved_count}, skipped {batchReport.skipped_count} (of{' '}
            {batchReport.total}).
          </p>
        ) : null}
      </details>
    </div>
  );
}
