import type { EventRegistrationQuestion } from './types';
import { normalizeRegistrationPrompt } from './registrationDefaultVisibility';

type AnswerMap = Record<string, string | string[] | boolean>;

const IDENTITY_PROMPT_MAP: Record<string, keyof IdentityFields> = {
  'first name': 'firstName',
  'last name': 'lastName',
  'e-mail address': 'email',
  email: 'email',
  'company name': 'companyName',
  'job title': 'jobTitle',
  'cell phone': 'cellPhone',
  'work phone': 'workPhone',
};

export interface IdentityFields {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  jobTitle: string;
  cellPhone: string;
  workPhone: string;
}

export function identityFromSubmission(submission: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  job_title?: string | null;
}): IdentityFields {
  return {
    firstName: submission.first_name ?? '',
    lastName: submission.last_name ?? '',
    email: submission.email ?? '',
    companyName: submission.company_name ?? '',
    jobTitle: submission.job_title ?? '',
    cellPhone: '',
    workPhone: '',
  };
}

/** Prefill identity question answers from submission row when answers are empty. */
export function prefillIdentityAnswers(
  questions: EventRegistrationQuestion[],
  answers: AnswerMap,
  submission: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    company_name?: string | null;
    job_title?: string | null;
  },
): AnswerMap {
  const identity = identityFromSubmission(submission);
  const next = { ...answers };

  for (const q of questions) {
    const key = IDENTITY_PROMPT_MAP[normalizeRegistrationPrompt(q.prompt)];
    if (!key) continue;
    const existing = next[q.id];
    if (existing !== undefined && String(existing).trim() !== '') continue;
    const value = identity[key];
    if (value) next[q.id] = value;
  }

  return next;
}

export function identityFromAnswers(
  questions: EventRegistrationQuestion[],
  answers: AnswerMap,
  fallback: IdentityFields,
): IdentityFields {
  const result = { ...fallback };
  for (const q of questions) {
    const key = IDENTITY_PROMPT_MAP[normalizeRegistrationPrompt(q.prompt)];
    if (!key) continue;
    const value = answers[q.id];
    if (typeof value === 'string' && value.trim()) {
      result[key] = value.trim();
    }
  }
  return result;
}

export function contactFieldsComplete(fields: IdentityFields): boolean {
  return [fields.firstName, fields.lastName, fields.email, fields.companyName, fields.jobTitle].every(
    (v) => v.trim().length > 0,
  );
}

export function requiredQuestionsComplete(questions: EventRegistrationQuestion[], answers: AnswerMap): boolean {
  return questions
    .filter((q) => q.is_required)
    .every((q) => {
      const value = answers[q.id];
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'boolean') return true;
      return String(value ?? '').trim() !== '';
    });
}
