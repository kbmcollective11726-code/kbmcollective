import { edgeFunctionHeaders, supabase, supabaseUrl } from '../lib/supabase';

export type RegistrationSetupEmailPayload = {
  event_id: string;
  email: string;
  full_name: string;
  attendee_type: 'attendee' | 'vendor' | 'user';
};

export async function sendRegistrationSetupEmail(payload: RegistrationSetupEmailPayload): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || !supabaseUrl) {
    throw new Error('Not signed in.');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/send-registration-setup-email`, {
    method: 'POST',
    headers: edgeFunctionHeaders(session.access_token),
    body: JSON.stringify(payload),
  });

  let body: { ok?: boolean; error?: string; emailed?: boolean; reason?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* ignore */
  }

  if (!res.ok || body.error) {
    throw new Error(body.error || `Could not send registration email (${res.status})`);
  }

  if (body.emailed === false && body.reason === 'RESEND_API_KEY not configured') {
    throw new Error(
      'Email service is not configured on the server. Contact the event organizer to set your password.'
    );
  }
}
