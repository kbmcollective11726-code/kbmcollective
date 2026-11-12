import { edgeFunctionHeaders, supabase, supabaseUrl } from './supabase';

export type SyncRegistrationMembershipResult = {
  ok: true;
  status: 'approved' | 'rejected';
  user_id: string | null;
  created_account?: boolean;
  membership_deactivated?: boolean;
  role?: string;
  message?: string;
};

/** Approve or reject a registration and sync Members / app access for that event. */
export async function syncRegistrationMembership(payload: {
  submission_id: string;
  status: 'approved' | 'rejected';
}): Promise<SyncRegistrationMembershipResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !supabaseUrl) {
    throw new Error('Not signed in.');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/sync-registration-membership`, {
    method: 'POST',
    headers: edgeFunctionHeaders(session.access_token),
    body: JSON.stringify(payload),
  });

  let body: SyncRegistrationMembershipResult & { error?: string } = { ok: true, status: payload.status, user_id: null };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok || body.error || !body.ok) {
    throw new Error(body.error || `Could not ${payload.status === 'approved' ? 'approve' : 'reject'} registration (${res.status})`);
  }

  return body;
}
