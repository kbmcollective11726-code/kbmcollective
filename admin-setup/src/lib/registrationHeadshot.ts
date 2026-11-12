import { supabase } from './supabase';
import { isHeadshotPrompt } from './specRegistrationQuestions';
import type { EventRegistrationQuestion } from './types';

/** Headshot fields that should become the app profile photo (`users.avatar_url`). */
export function isProfilePhotoRegistrationPrompt(prompt: string): boolean {
  const norm = prompt.trim().toLowerCase();
  return isHeadshotPrompt(prompt) || norm === 'speaker headshot';
}

/** Real uploaded image URLs only — reject placeholders, blobs, and data URLs. */
export function isUsableProfilePhotoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    if (host === 'example.com' || host.endsWith('.example.com') || host === 'localhost') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function findRegistrationHeadshotUrl(
  questions: EventRegistrationQuestion[],
  answers: Record<string, string | string[] | boolean | undefined>,
): string | null {
  for (const q of questions) {
    if (!isProfilePhotoRegistrationPrompt(q.prompt)) continue;
    const value = answers[q.id];
    if (typeof value === 'string' && isUsableProfilePhotoUrl(value)) return value.trim();
  }
  return null;
}

/** Copy a registration headshot URL onto the app user profile. */
export async function syncUserAvatarFromUrl(userId: string, imageUrl: string): Promise<void> {
  const url = imageUrl.trim();
  if (!userId || !isUsableProfilePhotoUrl(url)) return;
  const { error } = await supabase.from('users').update({ avatar_url: url }).eq('id', userId);
  if (error) throw error;
}
