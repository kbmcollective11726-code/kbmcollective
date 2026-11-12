import { edgeFunctionHeaders, supabaseUrl } from './supabase';

const DELETE_USER_TIMEOUT_MS = 120_000;

/** Permanently delete a user via the delete-user Edge Function. */
export async function deletePlatformUser(
  accessToken: string,
  userId: string,
): Promise<void> {
  if (!supabaseUrl) throw new Error('Missing Supabase URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_USER_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
      method: 'POST',
      headers: edgeFunctionHeaders(accessToken),
      body: JSON.stringify({ user_id: userId }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      const msg =
        res.status === 401
          ? body.error ||
            'Unauthorized (401). Sign out and sign in again, then retry.'
          : res.status === 504
            ? 'Delete timed out on the server (often slow photo cleanup). Wait a minute and try again.'
            : body.error || `Request failed (${res.status})`;
      throw new Error(msg);
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        'Delete timed out after 2 minutes. The server may still be working — refresh the page in a minute before trying again.',
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
