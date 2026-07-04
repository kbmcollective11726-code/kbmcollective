import { supabase } from './supabase';

export function parseAuthParamsFromUrl(): Record<string, string> {
  const out: Record<string, string> = {};
  const hash = window.location.hash.replace(/^#/, '');
  const search = window.location.search.replace(/^\?/, '');
  for (const part of [hash, search]) {
    if (!part) continue;
    new URLSearchParams(part).forEach((v, k) => {
      if (!(k in out)) out[k] = v;
    });
  }
  return out;
}

const OTP_TYPES = new Set(['invite', 'magiclink', 'recovery', 'email', 'signup']);

export async function establishPortalAuthSession(
  params: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const errDesc = params.error_description || params.error;
  if (errDesc) {
    return { ok: false, error: decodeURIComponent(errDesc.replace(/\+/g, ' ')) };
  }

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const code = params.code;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const tokenHash = params.token_hash;
  const type = params.type;
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'invite' | 'magiclink' | 'recovery' | 'email' | 'signup',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return { ok: false, error: 'missing_tokens' };
}

export function portalSetPasswordExpiredMessage(role: 'delegate' | 'vendor'): string {
  const label = role === 'vendor' ? 'Register vendor' : 'Register delegate';
  return `This link is missing or has expired. Go back to the registration page and tap ${label} again for a new link.`;
}
