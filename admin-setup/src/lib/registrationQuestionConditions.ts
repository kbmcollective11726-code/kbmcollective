import type { EventRegistrationQuestion } from './types';

export type RegistrationAnswerValue = string | string[] | boolean;
export type RegistrationAnswerMap = Record<string, RegistrationAnswerValue>;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** True when a question's conditional parent is answered with its configured value. */
export function isRegistrationQuestionVisible(
  question: Pick<EventRegistrationQuestion, 'condition_question_id' | 'condition_value'>,
  answers: RegistrationAnswerMap,
): boolean {
  if (!question.condition_question_id || !question.condition_value?.trim()) return true;
  const answer = answers[question.condition_question_id];
  const expected = normalize(question.condition_value);
  if (Array.isArray(answer)) return answer.some((value) => normalize(String(value)) === expected);
  if (typeof answer === 'boolean') {
    return (answer ? 'yes' : 'no') === expected || String(answer) === expected;
  }
  return typeof answer === 'string' && normalize(answer) === expected;
}

export function conditionalParentOptions(
  questions: EventRegistrationQuestion[],
  options: Array<{ question_id: string; value: string }>,
  currentQuestionId?: string,
): EventRegistrationQuestion[] {
  return questions.filter((question) => {
    if (question.id === currentQuestionId) return false;
    if (question.question_type === 'boolean') return true;
    return (
      question.question_type === 'single_select' &&
      options.some((option) => option.question_id === question.id)
    );
  });
}
