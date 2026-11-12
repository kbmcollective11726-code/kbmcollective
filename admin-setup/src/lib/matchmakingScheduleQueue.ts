import { interestLevelLabel } from './meetingRequests';
import type {
  EventMatchReview,
  EventMeetingInterestRequest,
  EventRegistrationSubmission,
  MeetingInterestLevel,
} from './types';

export type ScheduleQueueSegment = 'mutual' | 'delegate' | 'vendor';

export interface UnscheduledQueueItem {
  review: EventMatchReview;
  from: EventRegistrationSubmission;
  to: EventRegistrationSubmission;
  segment: ScheduleQueueSegment;
  forwardRequest: EventMeetingInterestRequest | null;
  reverseRequest: EventMeetingInterestRequest | null;
  forwardInterest: MeetingInterestLevel | null;
  reverseInterest: MeetingInterestLevel | null;
  forwardRank: number | null;
  isMutual: boolean;
}

const INTEREST_RANK: Record<MeetingInterestLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function interestSortValue(level: MeetingInterestLevel | null): number {
  return level ? INTEREST_RANK[level] : 0;
}

export function submissionLabel(submission: EventRegistrationSubmission): string {
  return (
    [submission.first_name, submission.last_name].filter(Boolean).join(' ') ||
    submission.email ||
    'Registrant'
  );
}

export function organizationLabel(submission: EventRegistrationSubmission): string {
  return submission.company_name?.trim() || submissionLabel(submission);
}

/** Prefer vendor on the left so schedule rows always read as vendor → delegate. */
export function resolveVendorDelegate(
  a: EventRegistrationSubmission | null | undefined,
  b: EventRegistrationSubmission | null | undefined,
): {
  vendor: EventRegistrationSubmission | null;
  delegate: EventRegistrationSubmission | null;
} {
  if (!a && !b) return { vendor: null, delegate: null };
  if (a && !b) {
    return a.attendee_type === 'vendor'
      ? { vendor: a, delegate: null }
      : { vendor: null, delegate: a };
  }
  if (!a && b) {
    return b.attendee_type === 'vendor'
      ? { vendor: b, delegate: null }
      : { vendor: null, delegate: b };
  }
  if (!a || !b) return { vendor: null, delegate: null };

  if (a.attendee_type === 'vendor' && b.attendee_type !== 'vendor') {
    return { vendor: a, delegate: b };
  }
  if (b.attendee_type === 'vendor' && a.attendee_type !== 'vendor') {
    return { vendor: b, delegate: a };
  }
  return { vendor: a, delegate: b };
}

export type MeetingPairDisplay = {
  /** Companies: Vendor Org → Delegate Org */
  title: string;
  /** People who will sit in the meeting */
  repsLine: string;
};

/**
 * One registration = one person (rep) for that org.
 * If a vendor has multiple reps, each is a separate submission / separate meetings.
 */
export function formatMeetingPairDisplay(
  a: EventRegistrationSubmission | null | undefined,
  b: EventRegistrationSubmission | null | undefined,
): MeetingPairDisplay {
  const { vendor, delegate } = resolveVendorDelegate(a, b);
  if (vendor && delegate) {
    const vOrg = organizationLabel(vendor);
    const dOrg = organizationLabel(delegate);
    const vRep = submissionLabel(vendor);
    const dRep = submissionLabel(delegate);
    return {
      title: `${vOrg} → ${dOrg}`,
      repsLine: `${vRep} (vendor) · ${dRep} (delegate)`,
    };
  }
  if (vendor) {
    return {
      title: organizationLabel(vendor),
      repsLine: `${submissionLabel(vendor)} (vendor)`,
    };
  }
  if (delegate) {
    return {
      title: organizationLabel(delegate),
      repsLine: `${submissionLabel(delegate)} (delegate)`,
    };
  }
  return { title: 'Unknown pairing', repsLine: '—' };
}

export function isMutualHighInterest(
  submissionAId: string,
  submissionBId: string,
  meetingRequests: EventMeetingInterestRequest[],
): boolean {
  let forwardHigh = false;
  let reverseHigh = false;
  for (const req of meetingRequests) {
    if (!req.target_submission_id) continue;
    if (
      req.submission_id === submissionAId &&
      req.target_submission_id === submissionBId &&
      req.interest_level === 'high'
    ) {
      forwardHigh = true;
    }
    if (
      req.submission_id === submissionBId &&
      req.target_submission_id === submissionAId &&
      req.interest_level === 'high'
    ) {
      reverseHigh = true;
    }
  }
  return forwardHigh && reverseHigh;
}

export function classifyScheduleSegment(
  from: EventRegistrationSubmission,
  _to: EventRegistrationSubmission,
  forward: EventMeetingInterestRequest | null,
  reverse: EventMeetingInterestRequest | null,
): ScheduleQueueSegment {
  const isMutual =
    forward?.interest_level === 'high' && reverse?.interest_level === 'high';

  if (isMutual) return 'mutual';
  if (from.attendee_type === 'vendor') return 'vendor';
  return 'delegate';
}

export function buildUnscheduledQueue(params: {
  reviews: EventMatchReview[];
  submissions: EventRegistrationSubmission[];
  meetingRequests: EventMeetingInterestRequest[];
}): UnscheduledQueueItem[] {
  const submissionById = new Map(params.submissions.map((s) => [s.id, s]));
  const requestByPair = new Map<string, EventMeetingInterestRequest>();
  const rankByPair = new Map<string, number>();

  const requestsBySender = new Map<string, EventMeetingInterestRequest[]>();
  for (const req of params.meetingRequests) {
    if (!req.target_submission_id) continue;
    requestByPair.set(`${req.submission_id}:${req.target_submission_id}`, req);
    const list = requestsBySender.get(req.submission_id) ?? [];
    list.push(req);
    requestsBySender.set(req.submission_id, list);
  }
  for (const [senderId, list] of requestsBySender) {
    const sorted = [...list].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    sorted.forEach((req, index) => {
      if (req.target_submission_id) {
        rankByPair.set(`${senderId}:${req.target_submission_id}`, index + 1);
      }
    });
  }

  const items: UnscheduledQueueItem[] = [];
  for (const review of params.reviews) {
    const from = submissionById.get(review.from_submission_id);
    const to = submissionById.get(review.to_submission_id);
    if (!from || !to) continue;
    const forward = requestByPair.get(`${from.id}:${to.id}`) ?? null;
    const reverse = requestByPair.get(`${to.id}:${from.id}`) ?? null;
    const segment = classifyScheduleSegment(from, to, forward, reverse);
    items.push({
      review,
      from,
      to,
      segment,
      forwardRequest: forward,
      reverseRequest: reverse,
      forwardInterest: forward?.interest_level ?? null,
      reverseInterest: reverse?.interest_level ?? null,
      forwardRank: rankByPair.get(`${from.id}:${to.id}`) ?? null,
      isMutual: segment === 'mutual',
    });
  }

  const segmentOrder: Record<ScheduleQueueSegment, number> = {
    mutual: 0,
    delegate: 1,
    vendor: 2,
  };

  return items.sort((a, b) => {
    const seg = segmentOrder[a.segment] - segmentOrder[b.segment];
    if (seg !== 0) return seg;
    const interest =
      Math.max(interestSortValue(b.forwardInterest), interestSortValue(b.reverseInterest)) -
      Math.max(interestSortValue(a.forwardInterest), interestSortValue(a.reverseInterest));
    if (interest !== 0) return interest;
    if (b.review.score !== a.review.score) return b.review.score - a.review.score;
    const rankA = a.forwardRank ?? 999;
    const rankB = b.forwardRank ?? 999;
    return rankA - rankB;
  });
}

export function queueItemDetailLines(item: UnscheduledQueueItem): string[] {
  const pair = formatMeetingPairDisplay(item.from, item.to);
  const lines: string[] = [pair.title, pair.repsLine];
  if (item.isMutual) lines.push('Mutual high interest (both sides)');
  if (item.forwardInterest) {
    lines.push(
      `${item.from.attendee_type === 'vendor' ? 'Vendor' : 'Delegate'} interest: ${interestLevelLabel(item.forwardInterest)}`,
    );
  }
  if (item.reverseInterest) {
    lines.push(
      `${item.to.attendee_type === 'vendor' ? 'Vendor' : 'Delegate'} interest: ${interestLevelLabel(item.reverseInterest)}`,
    );
  }
  if (item.forwardRank != null) lines.push(`Portal ranking: #${item.forwardRank}`);
  lines.push(`Match score: ${item.review.score}`);
  const fromDiaries = item.from.concurrent_meetings_per_slot ?? 1;
  const toDiaries = item.to.concurrent_meetings_per_slot ?? 1;
  if (fromDiaries > 1 || toDiaries > 1) {
    lines.push(
      `Capacity: ${submissionLabel(item.from)} ×${fromDiaries}, ${submissionLabel(item.to)} ×${toDiaries}`,
    );
  }
  return lines;
}

export function slotDayKey(iso: string): string {
  const trimmed = iso.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
    ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : trimmed;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatSlotDayLabel(dayKey: string): string {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dayKey;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]}, ${mons[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatSlotTimeOnly(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const trimmed = iso.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
      ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
      : trimmed;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return '—';
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export const SEGMENT_LABELS: Record<ScheduleQueueSegment, string> = {
  mutual: 'Mutual',
  delegate: 'Delegate pick',
  vendor: 'Vendor pick',
};
