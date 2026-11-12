import type { EventRegistrationQuestion, MatchmakingAudience } from './types';
import {
  isStage2RegistrationQuestion,
  normalizeRegistrationPrompt,
  TERMS_ACCEPTANCE_PROMPT,
} from './registrationDefaultVisibility';

/**
 * Stage 2 Registration Details — all non-hidden form questions (custom and default).
 * Respects admin Hide; excludes terms / username / always-hidden leftovers only.
 */
export function filterRegistrationDetailsQuestions(
  audience: MatchmakingAudience,
  questions: EventRegistrationQuestion[],
): EventRegistrationQuestion[] {
  const seenPrompts = new Set<string>();
  return questions.filter((q) => {
    if (!isStage2RegistrationQuestion(audience, q)) return false;
    const norm = normalizeRegistrationPrompt(q.prompt);
    if (seenPrompts.has(norm)) return false;
    seenPrompts.add(norm);
    return true;
  });
}

export { TERMS_ACCEPTANCE_PROMPT };
