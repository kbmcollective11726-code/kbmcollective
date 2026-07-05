import { supabase } from './supabase';
import type { EventMeetingInterestRequest, MeetingInterestLevel } from './types';

export interface MeetingRequestTarget {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  attendee_type: string;
  logo_url: string | null;
}

export interface MeetingRequestProfileAnswer {
  prompt: string;
  section_label: string | null;
  value: string;
}

export interface MeetingRequestTargetProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  attendee_type: string;
  answers: MeetingRequestProfileAnswer[];
  categories: string[];
}

export const INTEREST_LEVEL_OPTIONS: Array<{ value: MeetingInterestLevel; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function interestLevelLabel(level: MeetingInterestLevel | null | undefined): string {
  if (level === 'high') return 'High';
  if (level === 'low') return 'Low';
  if (level === 'medium') return 'Medium';
  return '—';
}

export function displayTargetName(target: Pick<MeetingRequestTarget, 'first_name' | 'last_name' | 'company_name'>): string {
  const person = [target.first_name, target.last_name].filter(Boolean).join(' ');
  if (target.company_name && person) return `${target.company_name} · ${person}`;
  return target.company_name || person || '—';
}

export async function loadMeetingRequestTargets(eventId: string, submissionId: string): Promise<MeetingRequestTarget[]> {
  const { data, error } = await supabase.rpc('list_meeting_request_targets', {
    p_event_id: eventId,
    p_submission_id: submissionId,
  });
  if (error) throw error;
  return (data as MeetingRequestTarget[]) ?? [];
}

export async function loadMeetingRequestTargetProfile(
  eventId: string,
  submissionId: string,
  targetSubmissionId: string,
): Promise<MeetingRequestTargetProfile> {
  const { data, error } = await supabase.rpc('get_meeting_request_target_profile', {
    p_event_id: eventId,
    p_submission_id: submissionId,
    p_target_submission_id: targetSubmissionId,
  });
  if (error) throw error;
  return data as MeetingRequestTargetProfile;
}

export async function loadOwnMeetingRequests(submissionId: string): Promise<EventMeetingInterestRequest[]> {
  const { data, error } = await supabase
    .from('event_meeting_interest_requests')
    .select('*')
    .eq('submission_id', submissionId)
    .order('priority', { ascending: true });
  if (error) throw error;
  return (data as EventMeetingInterestRequest[]) ?? [];
}

export async function createMeetingRequest(input: {
  eventId: string;
  submissionId: string;
  target: MeetingRequestTarget;
  interestLevel: MeetingInterestLevel;
  reason?: string;
  nextPriority: number;
}): Promise<void> {
  const { error } = await supabase.from('event_meeting_interest_requests').insert({
    event_id: input.eventId,
    submission_id: input.submissionId,
    target_submission_id: input.target.id,
    target_company_name: input.target.company_name,
    target_person_name: [input.target.first_name, input.target.last_name].filter(Boolean).join(' ') || null,
    reason: input.reason?.trim() || null,
    interest_level: input.interestLevel,
    priority: input.nextPriority,
  });
  if (error) throw error;
}

export async function updateMeetingRequestInterest(requestId: string, interestLevel: MeetingInterestLevel): Promise<void> {
  const { error } = await supabase
    .from('event_meeting_interest_requests')
    .update({ interest_level: interestLevel })
    .eq('id', requestId);
  if (error) throw error;
}

export async function updateMeetingRequestPriorities(
  rows: Array<{ id: string; priority: number }>,
): Promise<void> {
  for (const row of rows) {
    const { error } = await supabase
      .from('event_meeting_interest_requests')
      .update({ priority: row.priority })
      .eq('id', row.id);
    if (error) throw error;
  }
}

export async function deleteMeetingRequest(requestId: string): Promise<void> {
  const { error } = await supabase.from('event_meeting_interest_requests').delete().eq('id', requestId);
  if (error) throw error;
}

export function requestForTarget(
  requests: EventMeetingInterestRequest[],
  targetId: string,
): EventMeetingInterestRequest | undefined {
  return requests.find((r) => r.target_submission_id === targetId);
}

export function nextMeetingRequestPriority(requests: EventMeetingInterestRequest[]): number {
  if (requests.length === 0) return 0;
  return Math.max(...requests.map((r) => r.priority)) + 1;
}
