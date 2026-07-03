import { supabase } from './supabase';

export type TransferEventMeetingsResult = {
  ok?: boolean;
  error?: string;
  dry_run?: boolean;
  transferred?: number;
  skipped_conflict?: number;
};

function parseRpcRow(data: unknown): TransferEventMeetingsResult {
  const row = data as TransferEventMeetingsResult | null;
  if (!row || typeof row !== 'object') return { error: 'invalid_response' };
  if (row.error) return { error: String(row.error) };
  return row;
}

/** Preview or execute B2B meeting transfer for one event (event admin RPC). */
export async function transferEventMeetings(params: {
  eventId: string;
  fromUserId: string;
  toUserId: string;
  dryRun?: boolean;
}): Promise<TransferEventMeetingsResult> {
  const { data, error } = await supabase.rpc('admin_transfer_event_meetings', {
    p_event_id: params.eventId,
    p_from_user_id: params.fromUserId,
    p_to_user_id: params.toUserId,
    p_dry_run: params.dryRun ?? false,
  });
  if (error) return { error: error.message };
  return parseRpcRow(data);
}

export function transferMeetingsErrorMessage(code: string | undefined): string {
  switch ((code ?? '').trim()) {
    case 'not_authenticated':
      return 'You must be signed in.';
    case 'forbidden':
      return 'You do not have permission to transfer meetings for this event.';
    case 'same_user':
      return 'Choose a different member — source and target cannot be the same person.';
    case 'target_not_member':
      return 'The target person must be on this event first. Add them under Members, then retry.';
    case 'invalid_user':
      return 'Invalid member selected.';
    default:
      return code?.includes('_') ? 'Could not transfer meetings. Please try again.' : (code ?? 'Could not transfer meetings.');
  }
}
