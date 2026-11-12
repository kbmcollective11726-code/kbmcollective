import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_AUTO_SLOT_SETTINGS,
  approveAndAutoSchedule,
  getApproveSlotAvailability,
  homeTableForVendor,
  listApproveCandidateSlots,
  type AutoSlotDefaults,
} from '../lib/matchmakingAutoSchedule';
import {
  buildVendorDelegateRows,
  formatInterestCell,
  formatRankCell,
  formatScoreWhy,
  type VendorDelegateMatchRow,
} from '../lib/matchmakingVendorQueue';
import { formatSlotDayLabel, formatSlotTimeOnly, slotDayKey } from '../lib/matchmakingScheduleQueue';
import { formatB2BSlotRangeWallClock } from '../lib/b2bEventTime';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { supabase } from '../lib/supabase';
import type {
  EventMatchReview,
  EventMatchScheduledMeeting,
  EventMatchmakingAvailability,
  EventMatchmakingLocation,
  EventMatchmakingTimeSlot,
  EventMeetingInterestRequest,
  EventRegistrationSubmission,
} from '../lib/types';
import styles from '../pages/EventMatchmaking.module.css';

function submissionLabel(s: EventRegistrationSubmission): string {
  return [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email || 'Registrant';
}

type MatchSortKey = 'delegate' | 'company' | 'mutual' | 'interest' | 'ranks' | 'score' | 'status';
type MutualFilter = 'all' | 'yes' | 'no';
type StatusFilter = 'all' | 'pending' | 'approved' | 'scheduled' | 'rejected';

const INTEREST_SORT: Record<string, number> = { high: 3, medium: 2, low: 1 };

function rowDisplayStatus(row: VendorDelegateMatchRow): Exclude<StatusFilter, 'all'> {
  if (row.isScheduled) return 'scheduled';
  if (row.reviewStatus === 'approved') return 'approved';
  if (row.reviewStatus === 'rejected') return 'rejected';
  return 'pending';
}

const STATUS_SORT: Record<Exclude<StatusFilter, 'all'>, number> = {
  pending: 0,
  approved: 1,
  scheduled: 2,
  rejected: 3,
};

function interestSortValue(row: VendorDelegateMatchRow): number {
  return Math.max(
    row.vendorInterest ? INTEREST_SORT[row.vendorInterest] ?? 0 : 0,
    row.delegateInterest ? INTEREST_SORT[row.delegateInterest] ?? 0 : 0,
  );
}

function rankSortValue(row: VendorDelegateMatchRow): number {
  const ranks = [row.vendorRank, row.delegateRank].filter((n): n is number => n != null);
  return ranks.length ? Math.min(...ranks) : Number.POSITIVE_INFINITY;
}

function compareMatchRows(a: VendorDelegateMatchRow, b: VendorDelegateMatchRow, key: MatchSortKey): number {
  switch (key) {
    case 'delegate':
      return submissionLabel(a.delegate).localeCompare(submissionLabel(b.delegate));
    case 'company':
      return (a.delegate.company_name || '').localeCompare(b.delegate.company_name || '');
    case 'mutual':
      return Number(a.isMutual) - Number(b.isMutual);
    case 'interest':
      return interestSortValue(a) - interestSortValue(b);
    case 'ranks':
      return rankSortValue(a) - rankSortValue(b);
    case 'score':
      return a.score - b.score;
    case 'status':
      return STATUS_SORT[rowDisplayStatus(a)] - STATUS_SORT[rowDisplayStatus(b)];
    default:
      return 0;
  }
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

interface Props {
  eventId: string;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  submissions: EventRegistrationSubmission[];
  meetingRequests: EventMeetingInterestRequest[];
  reviews: EventMatchReview[];
  scheduledMeetings: EventMatchScheduledMeeting[];
  timeSlots: EventMatchmakingTimeSlot[];
  locations: EventMatchmakingLocation[];
  autoSlotDefaults: AutoSlotDefaults;
  onChanged: () => Promise<void>;
  onGoToSlots: () => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}

export default function MatchmakingVendorMatching({
  eventId,
  eventStartDate,
  eventEndDate,
  submissions,
  meetingRequests,
  reviews,
  scheduledMeetings,
  timeSlots,
  locations,
  autoSlotDefaults,
  onChanged,
  onGoToSlots,
  onError,
  onNotice,
}: Props) {
  const vendors = useMemo(
    () =>
      submissions
        .filter(
          (s) =>
            s.attendee_type === 'vendor' &&
            s.matching_opt_in !== false &&
            s.meetings_enabled !== false,
        )
        .sort((a, b) =>
          (a.company_name || submissionLabel(a)).localeCompare(b.company_name || submissionLabel(b)),
        ),
    [submissions],
  );
  const delegates = useMemo(
    () => submissions.filter((s) => s.attendee_type === 'attendee'),
    [submissions],
  );

  const [vendorId, setVendorId] = useState('');
  const [dayKey, setDayKey] = useState('');
  const [scored, setScored] = useState<
    Array<{ candidate_id: string; score: number; category_overlap: number }>
  >([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [actionKey, setActionKey] = useState('');
  /** Admin-picked slot per delegate; defaults to next available when unset/invalid. */
  const [slotPickByDelegate, setSlotPickByDelegate] = useState<Record<string, string>>({});
  const [availabilityRows, setAvailabilityRows] = useState<
    Array<Pick<EventMatchmakingAvailability, 'submission_id' | 'time_slot_id'>>
  >([]);
  const [sortKey, setSortKey] = useState<MatchSortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [mutualFilter, setMutualFilter] = useState<MutualFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const vendor = vendors.find((v) => v.id === vendorId) ?? null;

  useEffect(() => {
    // Never auto-pick a vendor — admin chooses. Clear only if the current id vanished.
    if (vendorId && vendors.length > 0 && !vendors.some((v) => v.id === vendorId)) {
      setVendorId('');
    }
  }, [vendors, vendorId]);

  const dayOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of timeSlots) keys.add(slotDayKey(slot.start_time));
    if (eventStartDate && eventEndDate) {
      const start = new Date(`${eventStartDate.slice(0, 10)}T00:00:00Z`);
      const end = new Date(`${eventEndDate.slice(0, 10)}T00:00:00Z`);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          keys.add(`${y}-${m}-${day}`);
        }
      }
    }
    if (keys.size === 0) {
      const today = new Date();
      keys.add(
        `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`,
      );
    }
    return Array.from(keys).sort();
  }, [timeSlots, eventStartDate, eventEndDate]);

  useEffect(() => {
    if (!dayKey && dayOptions[0]) setDayKey(dayOptions[0]);
    if (dayKey && !dayOptions.includes(dayKey) && dayOptions[0]) setDayKey(dayOptions[0]);
  }, [dayOptions, dayKey]);

  useEffect(() => {
    setSlotPickByDelegate({});
  }, [vendorId, dayKey]);

  useEffect(() => {
    if (!eventId) {
      setAvailabilityRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('event_matchmaking_availability')
          .select('submission_id, time_slot_id')
          .eq('event_id', eventId)
          .eq('is_available', true);
        if (error) throw error;
        if (cancelled) return;
        setAvailabilityRows(
          ((data ?? []) as Array<Pick<EventMatchmakingAvailability, 'submission_id' | 'time_slot_id'>>) ??
            [],
        );
      } catch {
        if (!cancelled) setAvailabilityRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, scheduledMeetings]);

  const availabilityBySubmission = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of availabilityRows) {
      let set = map.get(row.submission_id);
      if (!set) {
        set = new Set();
        map.set(row.submission_id, set);
      }
      set.add(row.time_slot_id);
    }
    return map;
  }, [availabilityRows]);

  useEffect(() => {
    if (!eventId || !vendor) {
      setScored([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingScores(true);
      try {
        const { data, error } = await supabase.rpc('rank_submission_matches', {
          p_event_id: eventId,
          p_submission_id: vendor.id,
          p_limit: 80,
        });
        if (error) throw error;
        if (cancelled) return;
        setScored(
          ((data ?? []) as Array<{ candidate_id: string; score: number; category_overlap: number }>).filter(
            (row) => row.score > 0,
          ),
        );
      } catch (cause) {
        if (!cancelled) onError(postgrestErrorMessage(cause) || 'Could not load match scores');
      } finally {
        if (!cancelled) setLoadingScores(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, vendor]);

  const scheduledReviewIds = useMemo(
    () =>
      new Set(
        scheduledMeetings
          .filter((m) => m.status === 'scheduled' && m.review_id)
          .map((m) => m.review_id as string),
      ),
    [scheduledMeetings],
  );

  const rows = useMemo(() => {
    if (!vendor) return [] as VendorDelegateMatchRow[];
    return buildVendorDelegateRows({
      vendor,
      delegates,
      meetingRequests,
      reviews,
      scheduledMeetings,
      scheduledReviewIds,
      scored,
    });
  }, [vendor, delegates, meetingRequests, reviews, scheduledMeetings, scheduledReviewIds, scored]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (mutualFilter === 'yes' && !row.isMutual) return false;
      if (mutualFilter === 'no' && row.isMutual) return false;
      if (statusFilter !== 'all' && rowDisplayStatus(row) !== statusFilter) return false;
      return true;
    });
    const sorted = filtered.slice().sort((a, b) => {
      const cmp = compareMatchRows(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, mutualFilter, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: MatchSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // Sensible first click: text A→Z, score/mutual/interest high→low, ranks best-first (asc), status workflow.
    setSortDir(key === 'delegate' || key === 'company' || key === 'ranks' || key === 'status' ? 'asc' : 'desc');
  };

  const sortIndicator = (key: MatchSortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const daySlotCount = useMemo(
    () =>
      timeSlots.filter(
        (slot) => slot.is_active !== false && dayKey && slotDayKey(slot.start_time) === dayKey,
      ).length,
    [timeSlots, dayKey],
  );

  const dayHasLocation = useMemo(
    () => locations.some((loc) => loc.is_active !== false),
    [locations],
  );

  const dayBlockReason = useMemo(() => {
    if (!dayKey) return 'Select a meeting day first.';
    if (daySlotCount === 0) {
      return 'This meeting day has no time blocks yet. Add them on Slots & locations before approving (separate from Max meetings on the vendor package).';
    }
    if (!dayHasLocation) {
      return 'No meeting tables/rooms yet. Add one on Slots & locations before approving.';
    }
    return null;
  }, [dayKey, daySlotCount, dayHasLocation]);

  /** Other matching-enabled vendor submissions at the same company (reps). */
  const companyReps = useMemo(() => {
    if (!vendor) return [] as EventRegistrationSubmission[];
    const company = (vendor.company_name || '').trim().toLowerCase();
    if (!company) return [vendor];
    return vendors
      .filter((v) => (v.company_name || '').trim().toLowerCase() === company)
      .sort((a, b) => submissionLabel(a).localeCompare(submissionLabel(b)));
  }, [vendor, vendors]);

  const candidatesForDelegate = (delegate: EventRegistrationSubmission) => {
    if (!vendor || !dayKey) return [];
    return listApproveCandidateSlots({
      dayKey,
      timeSlots,
      locations,
      meetings: scheduledMeetings,
      vendor,
      delegate,
      availabilityBySubmission,
    });
  };

  const resolvePreferredSlotId = (
    delegateId: string,
    candidates: ReturnType<typeof listApproveCandidateSlots>,
    reservedSlotIds?: Set<string>,
  ) => {
    if (!candidates.length) return null;
    const pick = slotPickByDelegate[delegateId];
    if (pick && candidates.some((c) => c.slot.id === pick)) return pick;
    const free = candidates.find((c) => !reservedSlotIds?.has(c.slot.id));
    return (free ?? candidates[0])?.slot.id ?? null;
  };

  /** Default picks stagger across pending rows so they don't all propose the same next free slot. */
  const preferredSlotByDelegate = useMemo(() => {
    const map = new Map<string, string | null>();
    if (!vendor || !dayKey) return map;
    const reserved = new Set<string>();
    const pending = visibleRows.filter(
      (row) => !row.isScheduled && row.reviewStatus !== 'rejected',
    );
    for (const row of pending) {
      const candidates = listApproveCandidateSlots({
        dayKey,
        timeSlots,
        locations,
        meetings: scheduledMeetings,
        vendor,
        delegate: row.delegate,
        availabilityBySubmission,
      });
      const slotId = resolvePreferredSlotId(row.delegate.id, candidates, reserved);
      map.set(row.delegate.id, slotId);
      if (slotId) reserved.add(slotId);
    }
    return map;
  }, [
    vendor,
    dayKey,
    visibleRows,
    timeSlots,
    locations,
    scheduledMeetings,
    availabilityBySubmission,
    slotPickByDelegate,
  ]);

  const formatScheduledMeetingLabel = (row: VendorDelegateMatchRow) => {
    if (!row.scheduledStart || !row.scheduledEnd) return '—';
    const meetDay = slotDayKey(row.scheduledStart);
    const time = formatSlotTimeOnly(row.scheduledStart, row.scheduledEnd);
    const dayPrefix =
      dayKey && meetDay && meetDay !== dayKey ? `${formatSlotDayLabel(meetDay)} · ` : '';
    return `${dayPrefix}${time}`;
  };

  const approve = async (row: VendorDelegateMatchRow) => {
    if (!vendor || !dayKey) {
      onError('Select a vendor and meeting day first.');
      return;
    }
    const candidates = candidatesForDelegate(row.delegate);
    const preferredTimeSlotId =
      preferredSlotByDelegate.get(row.delegate.id) ??
      resolvePreferredSlotId(row.delegate.id, candidates);
    const availability = getApproveSlotAvailability({
      dayKey,
      timeSlots,
      locations,
      meetings: scheduledMeetings,
      vendor,
      delegate: row.delegate,
      availabilityBySubmission,
    });
    if (!availability.ok) {
      onError(availability.message);
      return;
    }
    setActionKey(`approve:${row.delegate.id}`);
    onError('');
    try {
      const result = await approveAndAutoSchedule({
        eventId,
        vendor,
        delegate: row.delegate,
        score: row.score || 1,
        dayKey,
        defaults: autoSlotDefaults ?? DEFAULT_AUTO_SLOT_SETTINGS,
        existingMeetings: scheduledMeetings,
        existingReviews: reviews,
        timeSlots,
        locations,
        preferredTimeSlotId,
        availabilityBySubmission,
      });
      if (!result.ok) {
        onError(result.error);
        // Reload anyway in case approve landed before a schedule failure.
        await onChanged();
        return;
      }
      await onChanged();
      if (result.meetingScheduled) {
        const table = locations.find((l) => l.id === result.locationId);
        onNotice?.(
          `Approved and scheduled ${submissionLabel(row.delegate)}${
            table ? ` at ${table.name}` : ''
          }.`,
        );
      } else {
        onNotice?.(result.reason);
      }
    } finally {
      setActionKey('');
    }
  };

  const reject = async (row: VendorDelegateMatchRow) => {
    if (!vendor) return;
    setActionKey(`reject:${row.delegate.id}`);
    onError('');
    try {
      const { error } = await supabase.from('event_match_reviews').upsert(
        {
          event_id: eventId,
          from_submission_id: vendor.id,
          to_submission_id: row.delegate.id,
          score: row.score || 0,
          status: 'rejected',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,from_submission_id,to_submission_id' },
      );
      if (error) throw error;
      await onChanged();
      onNotice?.(`Rejected ${submissionLabel(row.delegate)}.`);
    } catch (cause) {
      onError(postgrestErrorMessage(cause) || 'Could not reject match');
    } finally {
      setActionKey('');
    }
  };

  const undoReject = async (row: VendorDelegateMatchRow) => {
    if (!vendor) return;
    setActionKey(`undo:${row.delegate.id}`);
    onError('');
    try {
      const { error } = await supabase.from('event_match_reviews').upsert(
        {
          event_id: eventId,
          from_submission_id: vendor.id,
          to_submission_id: row.delegate.id,
          score: row.score || 0,
          status: 'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,from_submission_id,to_submission_id' },
      );
      if (error) throw error;
      await onChanged();
      onNotice?.(`Restored ${submissionLabel(row.delegate)} to pending.`);
    } catch (cause) {
      onError(postgrestErrorMessage(cause) || 'Could not undo rejection');
    } finally {
      setActionKey('');
    }
  };

  const undoScheduled = async (row: VendorDelegateMatchRow) => {
    if (!vendor || !row.scheduledMeetingId) {
      onError('Could not find the scheduled meeting to cancel.');
      return;
    }
    if (
      !window.confirm(
        `Cancel the scheduled meeting with ${submissionLabel(row.delegate)}? They will go back to pending so you can approve again.`,
      )
    ) {
      return;
    }
    setActionKey(`unschedule:${row.delegate.id}`);
    onError('');
    try {
      const { error: cancelError } = await supabase.rpc('cancel_matchmaking_meeting', {
        p_meeting_id: row.scheduledMeetingId,
      });
      if (cancelError) throw cancelError;

      const { error: reviewError } = await supabase.from('event_match_reviews').upsert(
        {
          event_id: eventId,
          from_submission_id: vendor.id,
          to_submission_id: row.delegate.id,
          score: row.score || 0,
          status: 'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'event_id,from_submission_id,to_submission_id' },
      );
      if (reviewError) throw reviewError;

      await onChanged();
      onNotice?.(`Cancelled meeting with ${submissionLabel(row.delegate)} — back to pending.`);
    } catch (cause) {
      onError(postgrestErrorMessage(cause) || 'Could not cancel scheduled meeting');
    } finally {
      setActionKey('');
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>Approve and schedule</h2>
        <Badge
          label={`${vendors.length} vendors · ${visibleRows.length}${
            visibleRows.length !== rows.length ? ` of ${rows.length}` : ''
          } delegates`}
          tone="info"
        />
      </div>

      <div className={styles.matchingToolbar}>
        <label className={styles.field}>
          <span>Vendor</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">
              {vendors.length === 0 ? 'No vendors yet' : 'Select a vendor…'}
            </option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {(v.company_name || 'Vendor') + ' · ' + submissionLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Meeting day (on approve)</span>
          <select value={dayKey} onChange={(e) => setDayKey(e.target.value)}>
            {dayOptions.map((key) => (
              <option key={key} value={key}>
                {formatSlotDayLabel(key)}
                {timeSlots.some((s) => s.is_active !== false && slotDayKey(s.start_time) === key)
                  ? ''
                  : ' · no slots'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Mutual</span>
          <select
            value={mutualFilter}
            onChange={(e) => setMutualFilter(e.target.value as MutualFilter)}
          >
            <option value="all">All</option>
            <option value="yes">Mutual only</option>
            <option value="no">Not mutual</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="scheduled">Scheduled</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      {dayBlockReason ? (
        <p className={styles.hint}>
          {dayBlockReason}{' '}
          <button type="button" className={styles.tabLink} onClick={onGoToSlots}>
            Open Slots &amp; locations
          </button>
        </p>
      ) : dayKey && daySlotCount > 0 ? (
        <div className={styles.matchingDayMeta}>
          <p className={styles.hint}>
            This day ({formatSlotDayLabel(dayKey)}) has {daySlotCount} time block
            {daySlotCount === 1 ? '' : 's'} to book{' '}
            <em>(not the same as Max meetings on the vendor package)</em>.
            {vendor
              ? (() => {
                  const home = homeTableForVendor(locations, vendor.id);
                  return home
                    ? ` Approvals place meetings at ${home.name} when a free block is open.`
                    : ' No table attached yet — assign one on Slots & locations (otherwise any open table may be used).';
                })()
              : null}{' '}
            Meeting time shows the next free block — change it before Approve if needed.
          </p>
          {vendor && companyReps.length > 0 ? (
            <div className={styles.vendorRepsBar} aria-label="Vendor representatives">
              <span className={styles.vendorRepsLabel}>
                Reps{companyReps.length > 1 ? ` · ${companyReps.length}` : ''}
              </span>
              <div className={styles.vendorRepsList}>
                {companyReps.map((rep) => (
                  <span
                    key={rep.id}
                    className={`${styles.vendorRepChip}${
                      rep.id === vendor.id ? ` ${styles.vendorRepChipCurrent}` : ''
                    }`}
                  >
                    {submissionLabel(rep)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!vendor ? (
        <div className={styles.emptyState}>
          <strong>No vendor selected</strong>
          <p>Register and opt in vendors to start approving meetings.</p>
        </div>
      ) : loadingScores ? (
        <div className={styles.loading}>Loading intelligent scores…</div>
      ) : rows.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No delegates for this event</strong>
          <p>Register attendees on the Registrations tab to approve meetings for this vendor.</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No delegates match these filters</strong>
          <p>Try clearing Mutual or Status filters.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('delegate')}>
                    Delegate{sortIndicator('delegate')}
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('company')}>
                    Company{sortIndicator('company')}
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('mutual')}>
                    Mutual{sortIndicator('mutual')}
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('interest')}>
                    Interest{sortIndicator('interest')}
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('ranks')}>
                    Ranks{sortIndicator('ranks')}
                  </button>
                </th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('score')}>
                    Score{sortIndicator('score')}
                  </button>
                </th>
                <th title="Plain-language reasons behind the match score">Why this score</th>
                <th>Meeting time</th>
                <th>
                  <button type="button" className={styles.thSort} onClick={() => toggleSort('status')}>
                    Status{sortIndicator('status')}
                  </button>
                </th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const busy = actionKey.endsWith(`:${row.delegate.id}`);
                const isRejected = row.reviewStatus === 'rejected';
                const candidates = !row.isScheduled ? candidatesForDelegate(row.delegate) : [];
                const availability =
                  vendor && dayKey
                    ? getApproveSlotAvailability({
                        dayKey,
                        timeSlots,
                        locations,
                        meetings: scheduledMeetings,
                        vendor,
                        delegate: row.delegate,
                        availabilityBySubmission,
                      })
                    : null;
                const preferredSlotId =
                  preferredSlotByDelegate.get(row.delegate.id) ??
                  resolvePreferredSlotId(row.delegate.id, candidates);
                const approveDisabled = busy || row.isScheduled || isRejected || !availability?.ok;
                const approveTitle = row.isScheduled
                  ? 'Already scheduled'
                  : isRejected
                    ? 'Undo the rejection first, then Approve'
                    : availability && !availability.ok
                      ? availability.message
                      : undefined;
                const scheduledOffSelectedDay =
                  Boolean(
                    row.isScheduled &&
                      row.scheduledStart &&
                      dayKey &&
                      slotDayKey(row.scheduledStart) !== dayKey,
                  );
                return (
                  <tr
                    key={row.delegate.id}
                    className={isRejected ? styles.rowRejected : undefined}
                  >
                    <td>{submissionLabel(row.delegate)}</td>
                    <td>{row.delegate.company_name || '—'}</td>
                    <td>
                      {row.isMutual ? (
                        <Badge label="Mutual" tone="success" />
                      ) : (
                        <span className={styles.hint}>No</span>
                      )}
                    </td>
                    <td>{formatInterestCell(row.vendorInterest, row.delegateInterest)}</td>
                    <td>{formatRankCell(row.vendorRank, row.delegateRank)}</td>
                    <td>{row.score}</td>
                    <td>
                      <span className={styles.scheduleQueueMeta} title={formatScoreWhy(row)}>
                        {formatScoreWhy(row)}
                      </span>
                    </td>
                    <td>
                      {row.scheduledStart && row.scheduledEnd ? (
                        <span title={formatB2BSlotRangeWallClock(row.scheduledStart, row.scheduledEnd)}>
                          {formatScheduledMeetingLabel(row)}
                          {row.scheduledLocation ? (
                            <span className={styles.scheduleQueueMeta}>
                              {' '}
                              · {row.scheduledLocation}
                            </span>
                          ) : null}
                          {scheduledOffSelectedDay ? (
                            <span className={styles.scheduleQueueMeta}> (other day)</span>
                          ) : null}
                        </span>
                      ) : isRejected ? (
                        <span className={styles.hint} title="Undo rejection to pick a meeting time">
                          —
                        </span>
                      ) : candidates.length > 0 && preferredSlotId ? (
                        <label className={styles.meetingTimePick}>
                          <span className={styles.visuallyHidden}>Proposed meeting time</span>
                          <select
                            className={styles.meetingTimeSelect}
                            value={preferredSlotId}
                            disabled={busy}
                            onChange={(e) =>
                              setSlotPickByDelegate((prev) => ({
                                ...prev,
                                [row.delegate.id]: e.target.value,
                              }))
                            }
                          >
                            {candidates.map((c) => {
                              const isPreferred = c.slot.id === preferredSlotId;
                              const isEarliest = c.slot.id === candidates[0]?.slot.id;
                              return (
                                <option key={c.slot.id} value={c.slot.id}>
                                  {isPreferred && isEarliest
                                    ? 'Next · '
                                    : isPreferred
                                      ? 'Selected · '
                                      : ''}
                                  {formatSlotTimeOnly(c.slot.start_time, c.slot.end_time)}
                                  {c.location.name ? ` · ${c.location.name}` : ''}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      ) : (
                        <span className={styles.hint}>—</span>
                      )}
                    </td>
                    <td>
                      {row.isScheduled ? (
                        <Badge label="Scheduled" tone="info" />
                      ) : row.reviewStatus === 'approved' ? (
                        <Badge label="Approved" tone="success" />
                      ) : isRejected ? (
                        <Badge label="Rejected" tone="danger" />
                      ) : (
                        <Badge label="Pending" tone="warn" />
                      )}
                    </td>
                    <td className={styles.rowDecision}>
                      {row.isScheduled ? (
                        <div className={styles.actionRow}>
                          <span className={styles.decisionSettled} title="Meeting already on the schedule">
                            Done
                          </span>
                          <button
                            type="button"
                            className={styles.btnUndo}
                            disabled={busy || !row.scheduledMeetingId}
                            title={
                              row.scheduledMeetingId
                                ? 'Cancel this meeting and return to pending'
                                : 'Meeting id missing — cancel from Review schedule'
                            }
                            onClick={() => void undoScheduled(row)}
                          >
                            {actionKey === `unschedule:${row.delegate.id}` ? '…' : 'Undo'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className={styles.actionRow}>
                            <button
                              type="button"
                              className={styles.btnPrimary}
                              disabled={approveDisabled}
                              title={approveTitle}
                              onClick={() => void approve(row)}
                            >
                              {actionKey === `approve:${row.delegate.id}`
                                ? 'Scheduling…'
                                : row.reviewStatus === 'approved'
                                  ? 'Schedule'
                                  : 'Approve'}
                            </button>
                            {isRejected ? (
                              <button
                                type="button"
                                className={styles.btnUndo}
                                disabled={busy}
                                title="Restore to pending so you can Approve"
                                onClick={() => void undoReject(row)}
                              >
                                {actionKey === `undo:${row.delegate.id}` ? '…' : 'Undo'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.btnDangerOutline}
                                disabled={busy}
                                onClick={() => void reject(row)}
                              >
                                {actionKey === `reject:${row.delegate.id}` ? '…' : 'Reject'}
                              </button>
                            )}
                          </div>
                          {isRejected ? (
                            <div className={styles.rowRejectHint}>Undo rejection first, then Approve</div>
                          ) : null}
                          {!isRejected && availability && !availability.ok && !dayBlockReason ? (
                            <div className={styles.rowScheduleHint} title={availability.message}>
                              {row.reviewStatus === 'approved'
                                ? `Approved, but still needs a time. ${availability.message}`
                                : availability.message}
                            </div>
                          ) : null}
                        </>
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
  );
}
