import { supabase } from './supabase';

export type RegistrationAccountMetadata = {
  full_name: string;
  event_id: string;
  attendee_type: string;
};

function isAlreadyRegisteredError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('user already') ||
    m.includes('email address is already')
  );
}

function passwordMismatchMessage(): string {
  return 'The password you entered is incorrect for this email. If you registered before, use your existing password—or reset it from the login screen.';
}

/** Create or sign in an auth account during public registration (inline password). */
export async function ensureRegistrationAccount(
  email: string,
  password: string,
  metadata: RegistrationAccountMetadata
): Promise<{ userId: string; signedIn: boolean } | { error: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const fullName = metadata.full_name.trim();

  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUser = sessionData.session?.user;
  if (sessionUser?.email?.toLowerCase() === normalizedEmail && sessionUser.id) {
    return { userId: sessionUser.id, signedIn: true };
  }
  if (sessionUser && sessionUser.email?.toLowerCase() !== normalizedEmail) {
    await supabase.auth.signOut();
  }

  // Sign in first so returning users (e.g. after admin deleted their event registration) can re-register
  // with the same email without hitting "email already exists" from signUp.
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (!signInErr && signInData.user?.id) {
    return { userId: signInData.user.id, signedIn: true };
  }

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        full_name: fullName || null,
        event_id: metadata.event_id,
        attendee_type: metadata.attendee_type,
      },
    },
  });

  if (!signUpErr && signUpData.user?.id) {
    const userId = signUpData.user.id;
    const signedIn = !!signUpData.session?.user?.id;
    if (signedIn) {
      return { userId, signedIn: true };
    }
    const identities = signUpData.user.identities ?? [];
    if (identities.length === 0) {
      return { error: passwordMismatchMessage() };
    }
    return { userId, signedIn: false };
  }

  if (signUpErr && isAlreadyRegisteredError(signUpErr.message)) {
    return { error: passwordMismatchMessage() };
  }

  return { error: signUpErr?.message ?? 'Could not create your account. Please try again.' };
}
