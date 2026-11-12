import { interestLevelLabel } from './meetingRequests';
import type {
  EventMatchReview,
  EventMeetingInterestRequest,
  EventRegistrationSubmission,
  MeetingInterestLevel,
} from './types';

export interface VendorDelegateMatchRow {
  delegate: EventRegistrationSubmission;
  score: number;
  categoryOverlap: number;
  /** Both sides marked High interest on their meeting requests. */
  isMutual: boolean;
  /** Both sides sent a request (any interest), not declined. */
  bothRequested: boolean;
  vendorInterest: MeetingInterestLevel | null;
  delegateInterest: MeetingInterestLevel | null;
  vendorRank: number | null;
  delegateRank: number | null;
  review: EventMatchReview | null;
  reviewStatus: 'pending' | 'approved' | 'rejected' | null;
  isScheduled: boolean;
  scheduledMeetingId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledLocation: string | null;
}

const INTEREST_RANK: Record<MeetingInterestLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function interestValue(level: MeetingInterestLevel | null): number {
  return level ? INTEREST_RANK[level] : 0;
}

export function buildVendorDelegateRows(params: {
  vendor: EventRegistrationSubmission;
  delegates: EventRegistrationSubmission[];
  meetingRequests: EventMeetingInterestRequest[];
  reviews: EventMatchReview[];
  scheduledMeetings: Array<{
    id?: string;
    review_id: string | null;
    status: string;
    start_time: string;
    end_time: string;
    location: string | null;
    submission_a_id?: string;
    submission_b_id?: string;
  }>;
  scheduledReviewIds: Set<string>;
  scored: Array<{ candidate_id: string; score: number; category_overlap: number }>;
}): VendorDelegateMatchRow[] {
  const { vendor } = params;
  const scoreById = new Map(params.scored.map((row) => [row.candidate_id, row]));
  const meetingByReviewId = new Map(
    params.scheduledMeetings
      .filter((m) => m.status === 'scheduled' && m.review_id)
      .map((m) => [m.review_id as string, m]),
  );
  const meetingForPair = (delegateId: string) => {
    const byParticipants = params.scheduledMeetings.find(
      (m) =>
        m.status === 'scheduled' &&
        m.submission_a_id &&
        m.submission_b_id &&
        ((m.submission_a_id === vendor.id && m.submission_b_id === delegateId) ||
          (m.submission_a_id === delegateId && m.submission_b_id === vendor.id)),
    );
    return byParticipants ?? null;
  };

  const vendorOutgoing = params.meetingRequests
    .filter((r) => r.submission_id === vendor.id && r.target_submission_id)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  const vendorRankByTarget = new Map(
    vendorOutgoing.map((r, index) => [r.target_submission_id as string, index + 1]),
  );

  const requestByPair = new Map<string, EventMeetingInterestRequest>();
  const delegateRankByVendor = new Map<string, number>();
  for (const req of params.meetingRequests) {
    if (!req.target_submission_id) continue;
    requestByPair.set(`${req.submission_id}:${req.target_submission_id}`, req);
  }
  for (const delegate of params.delegates) {
    const allOutgoing = params.meetingRequests
      .filter((r) => r.submission_id === delegate.id && r.target_submission_id)
      .slice()
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    const idx = allOutgoing.findIndex((r) => r.target_submission_id === vendor.id);
    if (idx >= 0) delegateRankByVendor.set(delegate.id, idx + 1);
  }

  const reviewFor = (delegateId: string) =>
    params.reviews.find(
      (r) =>
        (r.from_submission_id === vendor.id && r.to_submission_id === delegateId) ||
        (r.from_submission_id === delegateId && r.to_submission_id === vendor.id),
    ) ?? null;

  // Show every non-rejected delegate for the selected vendor (score / requests optional).
  const includeIds = new Set<string>();
  for (const d of params.delegates) {
    if (d.registration_status === 'rejected') continue;
    includeIds.add(d.id);
  }

  const rows: VendorDelegateMatchRow[] = [];
  for (const delegate of params.delegates) {
    if (!includeIds.has(delegate.id)) continue;
    const vendorReq = requestByPair.get(`${vendor.id}:${delegate.id}`) ?? null;
    const delegateReq = requestByPair.get(`${delegate.id}:${vendor.id}`) ?? null;
    const bothRequested =
      vendorReq != null &&
      delegateReq != null &&
      vendorReq.response_status !== 'declined' &&
      delegateReq.response_status !== 'declined';
    const isMutual =
      vendorReq?.interest_level === 'high' && delegateReq?.interest_level === 'high';
    const scoredRow = scoreById.get(delegate.id);
    const review = reviewFor(delegate.id);
    const scheduled =
      (review ? meetingByReviewId.get(review.id) : undefined) ?? meetingForPair(delegate.id) ?? undefined;
    const isScheduled = Boolean(
      scheduled || (review && params.scheduledReviewIds.has(review.id)),
    );
    rows.push({
      delegate,
      score: scoredRow?.score ?? review?.score ?? 0,
      categoryOverlap: scoredRow?.category_overlap ?? 0,
      isMutual,
      bothRequested,
      vendorInterest: vendorReq?.interest_level ?? null,
      delegateInterest: delegateReq?.interest_level ?? null,
      vendorRank: vendorRankByTarget.get(delegate.id) ?? null,
      delegateRank: delegateRankByVendor.get(delegate.id) ?? null,
      review,
      reviewStatus: review?.status ?? null,
      isScheduled,
      scheduledMeetingId: scheduled?.id ?? null,
      scheduledStart: scheduled?.start_time ?? null,
      scheduledEnd: scheduled?.end_time ?? null,
      scheduledLocation: scheduled?.location ?? null,
    });
  }

  return rows.sort((a, b) => {
    if (a.isMutual !== b.isMutual) return a.isMutual ? -1 : 1;
    if (a.bothRequested !== b.bothRequested) return a.bothRequested ? -1 : 1;
    const interest =
      Math.max(interestValue(b.vendorInterest), interestValue(b.delegateInterest)) -
      Math.max(interestValue(a.vendorInterest), interestValue(a.delegateInterest));
    if (interest !== 0) return interest;
    if (b.score !== a.score) return b.score - a.score;
    const rankA = Math.min(a.vendorRank ?? 999, a.delegateRank ?? 999);
    const rankB = Math.min(b.vendorRank ?? 999, b.delegateRank ?? 999);
    return rankA - rankB;
  });
}

export function formatInterestCell(
  vendorInterest: MeetingInterestLevel | null,
  delegateInterest: MeetingInterestLevel | null,
): string {
  const parts: string[] = [];
  if (vendorInterest) parts.push(`Vendor ${interestLevelLabel(vendorInterest)}`);
  if (delegateInterest) parts.push(`Delegate ${interestLevelLabel(delegateInterest)}`);
  return parts.join(' · ') || '—';
}

export function formatRankCell(vendorRank: number | null, delegateRank: number | null): string {
  const parts: string[] = [];
  if (vendorRank != null) parts.push(`Vendor #${vendorRank}`);
  if (delegateRank != null) parts.push(`Delegate #${delegateRank}`);
  return parts.join(' · ') || '—';
}

/** Plain-language explanation of why this match scored the way it did. */
export function formatScoreWhy(row: VendorDelegateMatchRow): string {
  const parts: string[] = [];
  if (row.categoryOverlap > 0) {
    parts.push(
      row.categoryOverlap === 1
        ? 'Same solution category'
        : `${row.categoryOverlap} shared solution categories`,
    );
  }
  if (row.isMutual) {
    parts.push('both marked High interest');
  } else if (row.bothRequested) {
    parts.push('both asked to meet');
  } else if (row.vendorInterest && row.delegateInterest) {
    parts.push(
      `interest ${interestLevelLabel(row.vendorInterest)} (vendor) / ${interestLevelLabel(row.delegateInterest)} (delegate)`,
    );
  } else if (row.vendorInterest) {
    parts.push(`only vendor asked (${interestLevelLabel(row.vendorInterest)})`);
  } else if (row.delegateInterest) {
    parts.push(`only delegate asked (${interestLevelLabel(row.delegateInterest)})`);
  }
  if (row.vendorRank === 1 && row.delegateRank === 1) {
    parts.push('each ranked the other #1');
  } else if (row.vendorRank === 1) {
    parts.push('vendor ranked them #1');
  } else if (row.delegateRank === 1) {
    parts.push('delegate ranked this vendor #1');
  } else if (row.vendorRank != null || row.delegateRank != null) {
    const rankBits: string[] = [];
    if (row.vendorRank != null) rankBits.push(`vendor #${row.vendorRank}`);
    if (row.delegateRank != null) rankBits.push(`delegate #${row.delegateRank}`);
    parts.push(`portal ranks ${rankBits.join(', ')}`);
  }
  // Categories alone rarely clear ~15+; leftover usually means goals / seniority / size / text.
  const categoryCap = Math.min(40, row.categoryOverlap * 8);
  if (row.score > categoryCap + 15) {
    parts.push('plus form fit (goals, seniority, or company size)');
  } else if (row.score > 0 && parts.length === 0) {
    parts.push('form fit (goals, seniority, or company size)');
  }
  if (row.score <= 0) return 'No strong match signals yet';
  if (parts.length === 0) return 'Overall profile fit';
  const head = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1);
  return [head, ...parts.slice(1)].join(' · ');
}
