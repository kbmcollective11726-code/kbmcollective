import { edgeFunctionHeaders, supabase, supabaseUrl } from './supabase';

export type PortalFeatureActivationPayload = {
  event_id: string;
  activate_delegate_stage2?: boolean;
  activate_vendor_stage2?: boolean;
  activate_meeting_requests?: boolean;
};

export async function notifyPortalFeaturesOpened(
  payload: PortalFeatureActivationPayload,
): Promise<{ emailed: number; reason?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData.session?.access_token;
  if (!token) {
    await supabase.auth.refreshSession();
    const { data: refreshed } = await supabase.auth.getSession();
    token = refreshed.session?.access_token;
  }
  if (!token) {
    throw new Error('You must be signed in to notify registrants.');
  }

  let res = await fetch(`${supabaseUrl}/functions/v1/notify-portal-features-opened`, {
    method: 'POST',
    headers: edgeFunctionHeaders(token),
    body: JSON.stringify(payload),
  });

  if (res.status === 401) {
    await supabase.auth.refreshSession();
    const { data: refreshed } = await supabase.auth.getSession();
    if (refreshed.session?.access_token) {
      res = await fetch(`${supabaseUrl}/functions/v1/notify-portal-features-opened`, {
        method: 'POST',
        headers: edgeFunctionHeaders(refreshed.session.access_token),
        body: JSON.stringify(payload),
      });
    }
  }

  let body: { ok?: boolean; error?: string; emailed?: number; reason?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok || body.error) {
    throw new Error(body.error || `Could not send activation emails (${res.status})`);
  }

  return { emailed: body.emailed ?? 0, reason: body.reason };
}
