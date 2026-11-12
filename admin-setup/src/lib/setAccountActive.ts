import { edgeFunctionHeaders, supabase, supabaseUrl } from './supabase';

interface SetAccountActiveParams {
  userId: string;
  isActive: boolean;
  eventId?: string;
}

export async function setAccountActive(params: SetAccountActiveParams): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !supabaseUrl) throw new Error('Not signed in.');

  const response = await fetch(`${supabaseUrl}/functions/v1/set-account-active`, {
    method: 'POST',
    headers: edgeFunctionHeaders(session.access_token),
    body: JSON.stringify({
      user_id: params.userId,
      is_active: params.isActive,
      event_id: params.eventId || undefined,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    warning?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || `Could not update account status (${response.status}).`);
  }
  if (result.warning) {
    console.warn('[set-account-active]', result.warning);
  }
}
