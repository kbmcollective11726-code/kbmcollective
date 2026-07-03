import { supabase } from './supabase';

export type CadminMfaState = 'ready' | 'enroll' | 'verify' | 'checking';

export type MfaEnrollPayload = {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string | null;
};

type MfaFactor = {
  id: string;
  status?: string;
  factor_type?: string;
  friendly_name?: string;
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

export async function getCadminMfaState(): Promise<'ready' | 'enroll' | 'verify'> {
  const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
  if (factorsErr) throw factorsErr;

  const totpFactors = listTotpFactors(factors);
  const verifiedTotp = totpFactors.filter((f) => f.status === 'verified');
  const unverifiedTotp = totpFactors.filter((f) => (f.status as string) === 'unverified');

  if (unverifiedTotp.length > 0) {
    return 'verify';
  }

  if (verifiedTotp.length === 0) {
    return 'enroll';
  }

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr) throw aalErr;

  if (aal?.currentLevel !== 'aal2') {
    return 'verify';
  }

  return 'ready';
}

/** Remove stale unverified TOTP enrollments (e.g. user refreshed mid-setup). */
export async function clearUnverifiedTotpFactors() {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const unverified = listTotpFactors(factors).filter((f) => (f.status as string) === 'unverified');
  for (const factor of unverified) {
    const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollErr) throw unenrollErr;
  }
}

export async function enrollCadminMfa(): Promise<{ data: MfaEnrollPayload | null; error: Error | null }> {
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) {
    return { data: null, error: new Error(listErr.message) };
  }

  const existing = listTotpFactors(factors);
  const unverified = existing.filter((f) => (f.status as string) === 'unverified');
  if (unverified.length > 0) {
    return {
      data: null,
      error: new Error(
        'MFA setup was already started on this account. Enter the 6-digit code from your authenticator app to finish.'
      ),
    };
  }

  await clearUnverifiedTotpFactors();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'KBM cadmin',
    issuer: 'KBM Connect',
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already exists')) {
      return {
        data: null,
        error: new Error(
          'MFA was partially set up before. Enter the 6-digit code from your authenticator app, or sign out and try “Set up again” if you need a new QR code.'
        ),
      };
    }
    return { data: null, error: new Error(error.message) };
  }

  const totp = data?.totp as { qr_code?: string; secret?: string; uri?: string } | undefined;
  if (!data?.id || !totp?.secret) {
    return { data: null, error: new Error('Could not start MFA enrollment.') };
  }

  let qrCode = totp.qr_code ?? '';
  if (totp.uri) {
    try {
      const QRCode = (await import('qrcode')).default;
      qrCode = await QRCode.toDataURL(totp.uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
    } catch {
      if (!qrCode) {
        return { data: null, error: new Error('Could not generate MFA QR code.') };
      }
    }
  } else if (!qrCode) {
    return { data: null, error: new Error('Could not start MFA enrollment.') };
  }

  return {
    data: {
      factorId: data.id,
      qrCode,
      secret: totp.secret,
      uri: totp.uri ?? null,
    },
    error: null,
  };
}

export async function verifyCadminMfaEnrollment(factorId: string, code: string) {
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeErr) throw challengeErr;
  if (!challenge?.id) throw new Error('Could not start MFA verification.');

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (error) throw error;
  return data;
}

export async function verifyCadminMfaLogin(factorId: string, code: string) {
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeErr) throw challengeErr;
  if (!challenge?.id) throw new Error('Could not start MFA challenge.');

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (error) throw error;
  return data;
}

export async function getTotpFactorIdForChallenge(): Promise<{ factorId: string | null; completingEnrollment: boolean }> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const totpFactors = listTotpFactors(factors);
  const unverified = totpFactors.find((f) => (f.status as string) === 'unverified');
  if (unverified) {
    return { factorId: unverified.id, completingEnrollment: true };
  }
  const verified = totpFactors.find((f) => f.status === 'verified');
  return { factorId: verified?.id ?? null, completingEnrollment: false };
}

export async function getVerifiedTotpFactorId(): Promise<string | null> {
  const { factorId } = await getTotpFactorIdForChallenge();
  return factorId;
}
