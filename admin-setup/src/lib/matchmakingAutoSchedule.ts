import { datetimeLocalToUtcIsoWallClock } from './b2bEventTime';
import { slotDayKey } from './matchmakingScheduleQueue';
import { postgrestErrorMessage } from './postgrestErrorMessage';
import { supabase } from './supabase';
import type {
  EventMatchmakingLocation,
  EventMatchmakingTimeSlot,
  EventMatchReview,
  EventMatchScheduledMeeting,
  EventRegistrationSubmission,
} from './types';

export interface AutoSlotDefaults {
  default_meeting_minutes: number;
  auto_slot_start_hour: number;
  auto_slot_end_hour: number;
}

export const DEFAULT_AUTO_SLOT_SETTINGS: AutoSlotDefaults = {
  default_meeting_minutes: 30,
  auto_slot_start_hour: 9,
  auto_slot_end_hour: 17,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build wall-clock ISO range for a calendar day + hour:minute. */
export function wallClockRangeIso(
  dayKey: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): { startIso: string; endIso: string } | null {
  const startLocal = `${dayKey}T${pad2(startHour)}:${pad2(startMinute)}`;
  const endLocal = `${dayKey}T${pad2(endHour)}:${pad2(endMinute)}`;
  const startIso = datetimeLocalToUtcIsoWallClock(startLocal);
  const endIso = datetimeLocalToUtcIsoWallClock(endLocal);
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

export async function ensureDefaultLocation(eventId: string): Promise<EventMatchmakingLocation> {
  const existing = await supabase
    .from('event_matchmaking_locations')
    .select('*')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as EventMatchmakingLocation;

  const inserted = await supabase
    .from('event_matchmaking_locations')
    .insert({
      event_id: eventId,
      name: 'Table 1',
      capacity: 1,
      sort_order: 0,
      is_active: true,
    })
    .select('*')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data as EventMatchmakingLocation;
}

/** Create 1:1 slots for a day if none exist yet, using admin defaults. */
export async function ensureTimeSlotsForDay(
  eventId: string,
  dayKey: string,
  defaults: AutoSlotDefaults,
): Promise<EventMatchmakingTimeSlot[]> {
  const listed = await supabase
    .from('event_matchmaking_time_slots')
    .select('*')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('start_time', { ascending: true });
  if (listed.error) throw listed.error;
  const all = (listed.data as EventMatchmakingTimeSlot[]) ?? [];
  const forDay = all.filter((slot) => slotDayKey(slot.start_time) === dayKey);
  if (forDay.length > 0) return forDay;

  const duration = Math.max(5, Math.min(180, defaults.default_meeting_minutes || 30));
  let startHour = defaults.auto_slot_start_hour ?? 9;
  let endHour = defaults.auto_slot_end_hour ?? 17;
  if (endHour <= startHour) {
    startHour = 9;
    endHour = 17;
  }

  const rows: Array<{
    event_id: string;
    start_time: string;
    end_time: string;
    label: string | null;
    sort_order: number;
    is_active: boolean;
  }> = [];

  let sortOrder = all.length;
  for (let minutes = startHour * 60; minutes + duration <= endHour * 60; minutes += duration) {
    const sh = Math.floor(minutes / 60);
    const sm = minutes % 60;
    const endTotal = minutes + duration;
    const eh = Math.floor(endTotal / 60);
    const em = endTotal % 60;
    const range = wallClockRangeIso(dayKey, sh, sm, eh, em);
    if (!range) continue;
    rows.push({
      event_id: eventId,
      start_time: range.startIso,
      end_time: range.endIso,
      label: null,
      sort_order: sortOrder++,
      is_active: true,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      'Could not generate time slots for that day. Check default meeting hours on the Slots tab.',
    );
  }

  const inserted = await supabase.from('event_matchmaking_time_slots').insert(rows).select('*');
  if (inserted.error) throw inserted.error;
  return (inserted.data as EventMatchmakingTimeSlot[]) ?? [];
}

function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

function participantOverlapCount(
  meetings: EventMatchScheduledMeeting[],
  submissionId: string,
  slot: EventMatchmakingTimeSlot,
): number {
  return meetings.filter(
    (m) =>
      m.status === 'scheduled' &&
      (m.submission_a_id === submissionId || m.submission_b_id === submissionId) &&
      overlaps(m.start_time, m.end_time, slot.start_time, slot.end_time),
  ).length;
}

function locationUsage(
  meetings: EventMatchScheduledMeeting[],
  locationId: string,
  slot: EventMatchmakingTimeSlot,
): number {
  return meetings.filter(
    (m) =>
      m.status === 'scheduled' &&
      m.location_id === locationId &&
      overlaps(m.start_time, m.end_time, slot.start_time, slot.end_time),
  ).length;
}

export type SlotAvailability =
  | { ok: true; slotCount: number; freeSlotCount: number; homeTableOnly: boolean }
  | {
      ok: false;
      reason: 'no_slots' | 'no_location' | 'no_free_slot' | 'no_home_table';
      message: string;
      slotCount: number;
      freeSlotCount: number;
      homeTableOnly: boolean;
    };

/** Active locations for scheduling this vendor: home tables only when assigned. */
export function locationsForVendor(
  locations: EventMatchmakingLocation[],
  vendorId: string,
): { locations: EventMatchmakingLocation[]; hasHomeTable: boolean } {
  const active = locations
    .filter((loc) => loc.is_active !== false)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const home = active.filter((loc) => loc.vendor_submission_id === vendorId);
  if (home.length > 0) return { locations: home, hasHomeTable: true };
  return { locations: active, hasHomeTable: false };
}

export function homeTableForVendor(
  locations: EventMatchmakingLocation[],
  vendorId: string,
): EventMatchmakingLocation | null {
  return (
    locations.find(
      (loc) => loc.is_active !== false && loc.vendor_submission_id === vendorId,
    ) ?? null
  );
}

function formatDayBlockCount(n: number): string {
  return `${n} time block${n === 1 ? '' : 's'}`;
}

/** Plain-language why Approve/Schedule cannot place a meeting on this day. */
export function explainNoFreeApproveSlot(params: {
  hasHomeTable: boolean;
  locationNames: string[];
  slotCount: number;
}): string {
  const blocks = formatDayBlockCount(params.slotCount);
  const packageNote =
    'This is about open times that day — not Max meetings on the vendor package.';
  if (params.hasHomeTable) {
    const booth = params.locationNames.join(', ') || 'their assigned table';
    return (
      `Cannot schedule yet: this day only has ${blocks}, and all are already taken at ${booth}. ` +
      `${packageNote} ` +
      `Add another time on Slots & locations, pick a different meeting day, undo a scheduled meeting to free a block, or raise Meetings / slot if this vendor can host more than one meeting at once.`
    );
  }
  return (
    `Cannot schedule yet: this day only has ${blocks}, and none are free for this vendor and delegate. ` +
    `${packageNote} ` +
    `Pick another day, undo a scheduled meeting, or add more times on Slots & locations.`
  );
}

/** Whether Approve can place this pair into an existing slot on the selected day. */
export function getApproveSlotAvailability(params: {
  dayKey: string;
  timeSlots: EventMatchmakingTimeSlot[];
  locations: EventMatchmakingLocation[];
  meetings: EventMatchScheduledMeeting[];
  vendor: EventRegistrationSubmission;
  delegate: EventRegistrationSubmission;
  availabilityBySubmission?: Map<string, Set<string>>;
}): SlotAvailability {
  const candidates = listApproveCandidateSlots(params);
  const daySlots = params.timeSlots.filter(
    (slot) => slot.is_active !== false && slotDayKey(slot.start_time) === params.dayKey,
  );
  if (daySlots.length === 0) {
    return {
      ok: false,
      reason: 'no_slots',
      message:
        'Cannot schedule yet: this meeting day has no time blocks. Add times on Slots & locations first (this is separate from Max meetings on the vendor package).',
      slotCount: 0,
      freeSlotCount: 0,
      homeTableOnly: false,
    };
  }

  const { locations, hasHomeTable } = locationsForVendor(params.locations, params.vendor.id);
  if (locations.length === 0) {
    return {
      ok: false,
      reason: 'no_location',
      message:
        'Cannot schedule yet: no meeting tables/rooms exist. Add one on Slots & locations, then try again.',
      slotCount: daySlots.length,
      freeSlotCount: 0,
      homeTableOnly: false,
    };
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: hasHomeTable ? 'no_home_table' : 'no_free_slot',
      message: explainNoFreeApproveSlot({
        hasHomeTable,
        locationNames: locations.map((l) => l.name),
        slotCount: daySlots.length,
      }),
      slotCount: daySlots.length,
      freeSlotCount: 0,
      homeTableOnly: hasHomeTable,
    };
  }

  return {
    ok: true,
    slotCount: daySlots.length,
    freeSlotCount: candidates.length,
    homeTableOnly: hasHomeTable,
  };
}

export type ApproveCandidateSlot = {
  slot: EventMatchmakingTimeSlot;
  location: EventMatchmakingLocation;
};

function submissionAllowsSlot(
  submissionId: string,
  slotId: string,
  availabilityBySubmission?: Map<string, Set<string>>,
): boolean {
  if (!availabilityBySubmission) return true;
  const set = availabilityBySubmission.get(submissionId);
  // Missing key or empty set → unconstrained (same as schedule RPC).
  if (!set || set.size === 0) return true;
  return set.has(slotId);
}

/** Free slots for this pair on the day, earliest first (next available first). */
export function listApproveCandidateSlots(params: {
  dayKey: string;
  timeSlots: EventMatchmakingTimeSlot[];
  locations: EventMatchmakingLocation[];
  meetings: EventMatchScheduledMeeting[];
  vendor: EventRegistrationSubmission;
  delegate: EventRegistrationSubmission;
  availabilityBySubmission?: Map<string, Set<string>>;
}): ApproveCandidateSlot[] {
  if (params.vendor.meetings_enabled === false || params.delegate.meetings_enabled === false) {
    return [];
  }
  const daySlots = params.timeSlots
    .filter((slot) => slot.is_active !== false && slotDayKey(slot.start_time) === params.dayKey)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const { locations } = locationsForVendor(params.locations, params.vendor.id);
  if (daySlots.length === 0 || locations.length === 0) return [];

  const meetings = params.meetings.filter((m) => m.status === 'scheduled');
  const vendorDiaries = params.vendor.concurrent_meetings_per_slot ?? 1;
  const delegateDiaries = params.delegate.concurrent_meetings_per_slot ?? 1;
  const out: ApproveCandidateSlot[] = [];

  for (const slot of daySlots) {
    if (!submissionAllowsSlot(params.vendor.id, slot.id, params.availabilityBySubmission)) continue;
    if (!submissionAllowsSlot(params.delegate.id, slot.id, params.availabilityBySubmission)) continue;
    if (participantOverlapCount(meetings, params.vendor.id, slot) >= vendorDiaries) continue;
    if (participantOverlapCount(meetings, params.delegate.id, slot) >= delegateDiaries) continue;
    const location = locations.find(
      (loc) => locationUsage(meetings, loc.id, slot) < (loc.capacity || 1),
    );
    if (!location) continue;
    out.push({ slot, location });
  }
  return out;
}

export type AutoScheduleResult =
  | { ok: true; reviewId: string; meetingScheduled: true; timeSlotId: string; locationId: string }
  | { ok: true; reviewId: string; meetingScheduled: false; reason: string }
  | { ok: false; error: string };

function pairAlreadyHasMeeting(
  meetings: EventMatchScheduledMeeting[],
  aId: string,
  bId: string,
): EventMatchScheduledMeeting | undefined {
  return meetings.find(
    (m) =>
      m.status === 'scheduled' &&
      ((m.submission_a_id === aId && m.submission_b_id === bId) ||
        (m.submission_a_id === bId && m.submission_b_id === aId)),
  );
}

function findPairReview(
  reviews: EventMatchReview[],
  aId: string,
  bId: string,
): EventMatchReview | undefined {
  // Prefer vendor→delegate direction when both exist.
  return (
    reviews.find((r) => r.from_submission_id === aId && r.to_submission_id === bId) ??
    reviews.find((r) => r.from_submission_id === bId && r.to_submission_id === aId)
  );
}

/**
 * Approve vendor→delegate pairing and place into the first free existing slot that day.
 * Does not create slots — admin must set them up first (Approve is disabled when none are free).
 */
export async function approveAndAutoSchedule(params: {
  eventId: string;
  vendor: EventRegistrationSubmission;
  delegate: EventRegistrationSubmission;
  score: number;
  dayKey: string;
  defaults: AutoSlotDefaults;
  existingMeetings: EventMatchScheduledMeeting[];
  existingReviews: EventMatchReview[];
  timeSlots: EventMatchmakingTimeSlot[];
  locations: EventMatchmakingLocation[];
  /** When set, try this slot first (admin pick from Matching). */
  preferredTimeSlotId?: string | null;
  availabilityBySubmission?: Map<string, Set<string>>;
}): Promise<AutoScheduleResult> {
  const { eventId, vendor, delegate, score, dayKey } = params;

  try {
    const availability = getApproveSlotAvailability({
      dayKey,
      timeSlots: params.timeSlots,
      locations: params.locations,
      meetings: params.existingMeetings,
      vendor,
      delegate,
      availabilityBySubmission: params.availabilityBySubmission,
    });
    if (!availability.ok) {
      return { ok: false, error: availability.message };
    }

    const existingMeeting = pairAlreadyHasMeeting(params.existingMeetings, vendor.id, delegate.id);
    if (existingMeeting) {
      return {
        ok: true,
        reviewId: existingMeeting.review_id ?? '',
        meetingScheduled: false,
        reason: 'Already scheduled',
      };
    }

    const existingPair = findPairReview(params.existingReviews, vendor.id, delegate.id);
    let review: EventMatchReview;

    if (existingPair) {
      // Reuse either-direction review so we do not create a ghost opposite-direction row.
      if (existingPair.status !== 'approved' || existingPair.score !== score) {
        const updated = await supabase
          .from('event_match_reviews')
          .update({
            status: 'approved',
            score,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPair.id)
          .select('*')
          .single();
        if (updated.error) throw updated.error;
        review = updated.data as EventMatchReview;
      } else {
        review = existingPair;
      }

      // Soft-cancel any opposite-direction approved duplicate so Schedule queue stays clean.
      const opposite = params.existingReviews.find(
        (r) =>
          r.id !== existingPair.id &&
          ((r.from_submission_id === vendor.id && r.to_submission_id === delegate.id) ||
            (r.from_submission_id === delegate.id && r.to_submission_id === vendor.id)),
      );
      if (opposite && opposite.status === 'approved') {
        await supabase
          .from('event_match_reviews')
          .update({ status: 'rejected', updated_at: new Date().toISOString() })
          .eq('id', opposite.id);
      }
    } else {
      const upsert = await supabase
        .from('event_match_reviews')
        .upsert(
          {
            event_id: eventId,
            from_submission_id: vendor.id,
            to_submission_id: delegate.id,
            score,
            status: 'approved',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,from_submission_id,to_submission_id' },
        )
        .select('*')
        .single();
      if (upsert.error) throw upsert.error;
      review = upsert.data as EventMatchReview;
    }

    const daySlots = params.timeSlots
      .filter((slot) => slot.is_active !== false && slotDayKey(slot.start_time) === dayKey)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const preferredId = (params.preferredTimeSlotId ?? '').trim();
    const orderedSlots = preferredId
      ? [
          ...daySlots.filter((s) => s.id === preferredId),
          ...daySlots.filter((s) => s.id !== preferredId),
        ]
      : daySlots;
    // If this vendor has assigned table(s), schedule ONLY there — never fall back to another vendor's table.
    const { locations, hasHomeTable } = locationsForVendor(params.locations, vendor.id);
    if (locations.length === 0) {
      return {
        ok: true,
        reviewId: review.id,
        meetingScheduled: false,
        reason:
          'Approved (match saved), but not scheduled: no table/room is available. Attach a table to this vendor on Slots & locations, then open Review and publish to place the meeting.',
      };
    }

    // Re-load scheduled meetings so rapid Approves don't pick the same slot from a stale list.
    const freshMeetingsRes = await supabase
      .from('event_match_scheduled_meetings')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'scheduled');
    if (freshMeetingsRes.error) throw freshMeetingsRes.error;
    const meetings = ((freshMeetingsRes.data as EventMatchScheduledMeeting[]) ?? []).filter(
      (m) => m.status === 'scheduled',
    );
    if (pairAlreadyHasMeeting(meetings, vendor.id, delegate.id)) {
      return {
        ok: true,
        reviewId: review.id,
        meetingScheduled: false,
        reason: 'Already scheduled',
      };
    }
    if (vendor.meetings_enabled === false) {
      return {
        ok: true,
        reviewId: review.id,
        meetingScheduled: false,
        reason:
          'Approved (match saved), but not scheduled: this vendor’s package has meetings turned off. Turn meetings on under Slots & locations → Vendor meeting package.',
      };
    }
    if (delegate.meetings_enabled === false) {
      return {
        ok: true,
        reviewId: review.id,
        meetingScheduled: false,
        reason:
          'Approved (match saved), but not scheduled: this delegate is not enabled for meetings.',
      };
    }
    const vendorDiaries = vendor.concurrent_meetings_per_slot ?? 1;
    const delegateDiaries = delegate.concurrent_meetings_per_slot ?? 1;
    let lastHardError = '';

    for (const slot of orderedSlots) {
      if (!submissionAllowsSlot(vendor.id, slot.id, params.availabilityBySubmission)) continue;
      if (!submissionAllowsSlot(delegate.id, slot.id, params.availabilityBySubmission)) continue;
      if (participantOverlapCount(meetings, vendor.id, slot) >= vendorDiaries) continue;
      if (participantOverlapCount(meetings, delegate.id, slot) >= delegateDiaries) continue;

      for (const location of locations) {
        if (locationUsage(meetings, location.id, slot) >= (location.capacity || 1)) continue;

        const { error: scheduleError } = await supabase.rpc('schedule_matchmaking_review', {
          p_review_id: review.id,
          p_time_slot_id: slot.id,
          p_location_id: location.id,
          p_notes: null,
          p_override_availability: false,
        });

        if (!scheduleError) {
          return {
            ok: true,
            reviewId: review.id,
            meetingScheduled: true,
            timeSlotId: slot.id,
            locationId: location.id,
          };
        }

        const msg = postgrestErrorMessage(scheduleError) || scheduleError.message || '';
        if (/unavailable|locked|limit|capacity|already has|maximum concurrent|not enabled/i.test(msg)) {
          continue;
        }
        lastHardError = msg || 'Could not schedule meeting';
      }
    }

    // Approved in DB — surface on Schedule Unscheduled even if placement failed.
    const placementWhy =
      lastHardError ||
      explainNoFreeApproveSlot({
        hasHomeTable,
        locationNames: locations.map((l) => l.name),
        slotCount: daySlots.length,
      });
    return {
      ok: true,
      reviewId: review.id,
      meetingScheduled: false,
      reason: `Approved (match saved), but not scheduled. ${placementWhy} Open Review and publish to place it manually.`,
    };
  } catch (cause) {
    return { ok: false, error: postgrestErrorMessage(cause) || 'Could not approve and schedule' };
  }
}
