/** Plain-language copy for password reset — never show Supabase/localhost jargon to attendees. */

export const PASSWORD_RECOVERY_MESSAGES = {
  opening: 'Opening your reset link…',
  verifying: 'Verifying your reset link…',
  signingIn: 'Almost there…',
  linkExpired:
    'This reset link has expired or was already used. On the login screen, tap Forgot password to request a new email.',
  linkInvalid:
    'This reset link is not valid. On the login screen, tap Forgot password to request a new email.',
  linkMissing:
    "This reset link didn't work — it may be expired or from an older email. You don't need your current password. Tap the button below to get a new reset email.",
  linkNotFound:
    'We did not receive a reset link. Open the newest email from KBM Connect and tap Reset my password again.',
  linkTooOld:
    'Please request a new password reset from the login screen and open only the newest email.',
  takingTooLong:
    'This is taking longer than expected. Close the app, open your newest reset email, and tap the link again.',
  networkTimeout:
    'The connection timed out. Check Wi‑Fi or mobile data, then open the reset link from your newest email again.',
  genericFailure:
    'We could not complete the password reset. Tap Forgot password on the login screen to request a new email.',
} as const;

export function friendlyPasswordRecoveryError(raw?: string | null): string {
  if (!raw?.trim()) return PASSWORD_RECOVERY_MESSAGES.genericFailure;

  const text = raw.toLowerCase();

  if (text.includes('auth session missing') || text.includes('session missing')) {
    return PASSWORD_RECOVERY_MESSAGES.linkExpired;
  }
  if (
    text.includes('expired') ||
    text.includes('invalid') ||
    text.includes('otp') ||
    text.includes('already been used')
  ) {
    return PASSWORD_RECOVERY_MESSAGES.linkExpired;
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return PASSWORD_RECOVERY_MESSAGES.networkTimeout;
  }
  if (text.includes('network') || text.includes('fetch failed') || text.includes('connection')) {
    return PASSWORD_RECOVERY_MESSAGES.networkTimeout;
  }

  return PASSWORD_RECOVERY_MESSAGES.genericFailure;
}
