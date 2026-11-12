import { supabase } from './supabase';

type MfaFactor = {
  id: string;
  status?: string;
  factor_type?: string;
};

function listTotpFactors(factors: { all?: MfaFactor[]; totp?: MfaFactor[] } | null | undefined) {
  const merged = [...(factors?.all ?? []), ...(factors?.totp ?? [])];
  const seen = new Set<string>();
  return merged.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    const type = f.factor_type ?? 'totp';
    return type === 'totp';
  });
}

/** True when password/email updates need MFA (verified factor, session still AAL1). */
export async function needsMfaBeforeSensitiveUpdate(): Promise<boolean> {
  try {
    const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !aal) return false;
    return aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2';
  } catch {
    return false;
  }
}

export async function getVerifiedTotpFactorId(): Promise<string | null> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  const verified = listTotpFactors(factors).find((f) => f.status === 'verified');
  return verified?.id ?? null;
}

/** Challenge + verify TOTP to elevate session to AAL2 (required for password updates when MFA is on). */
export async function verifyTotpToAal2(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, message: 'Enter the 6-digit code from your authenticator app.' };
  }

  try {
    const factorId = await getVerifiedTotpFactorId();
    if (!factorId) {
      return {
        ok: false,
        message: 'No authenticator is set up on this account. Contact an admin to reset MFA, then try again.',
      };
    }

    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challenge?.id) {
      return { ok: false, message: challengeErr?.message || 'Could not start MFA verification.' };
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: trimmed,
    });
    if (verifyErr) {
      return { ok: false, message: verifyErr.message || 'Invalid code. Try again.' };
    }

    await supabase.auth.refreshSession();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg || 'MFA verification failed.' };
  }
}

export function isAal2PasswordError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('aal2') || (m.includes('mfa') && m.includes('password'));
}
