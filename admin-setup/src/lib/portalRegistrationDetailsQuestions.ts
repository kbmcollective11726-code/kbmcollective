import type { EventRegistrationQuestion, MatchmakingAudience } from './types';
import {
  isStage2RegistrationQuestion,
  normalizeRegistrationPrompt,
  TERMS_ACCEPTANCE_PROMPT,
} from './registrationDefaultVisibility';

/**
 * Stage 2 Registration Details — Master Build Spec §5–§6 defaults plus admin custom questions.
 * Respects admin `is_hidden` from Matchmaking setup.
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
