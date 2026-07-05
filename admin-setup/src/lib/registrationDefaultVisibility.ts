import type { MatchmakingAudience, EventRegistrationQuestion } from './types';
import {
  isHeadshotPrompt,
  isSolutionCategoryInterestPrompt,
  SPEC_DELEGATE_STAGE2_PROMPTS,
  SPEC_VENDOR_STAGE2_PROMPTS,
} from './specRegistrationQuestions';

/** Prompts collected in the Stage 1 registration header grid — not repeated in the question list. */
export const REGISTRATION_TOP_GRID_PROMPTS = new Set(
  ['company name', 'first name', 'last name', 'e-mail address', 'email', 'job title'].map((p) => p.toLowerCase()),
);

export const REGISTRATION_HEADER_FIELD_PROMPTS = new Set(
  [...REGISTRATION_TOP_GRID_PROMPTS, 'cell phone'],
);

export const TERMS_ACCEPTANCE_PROMPT =
  'I have read and accept the Terms and Conditions and Code of Conduct';

const STAGE1_DELEGATE_PROMPTS = new Set(
  [
    'First Name',
    'Last Name',
    'E-Mail Address',
    'Email',
    'Company Name',
    'Job Title',
    'Cell Phone',
    TERMS_ACCEPTANCE_PROMPT,
  ].map((p) => p.toLowerCase()),
);

const STAGE1_VENDOR_PROMPTS = new Set(
  [
    'First Name',
    'Last Name',
    'E-Mail Address',
    'Email',
    'Company Name',
    'Job Title',
    'Cell Phone',
    TERMS_ACCEPTANCE_PROMPT,
  ].map((p) => p.toLowerCase()),
);

const STAGE1_SPEAKER_PROMPTS = new Set(
  [
    'First Name',
    'Last Name',
    'E-Mail Address',
    'Email',
    'Company Name',
    'Job Title',
    'Cell Phone',
    'Work Phone',
    TERMS_ACCEPTANCE_PROMPT,
    'Speaker Bio',
    'Speaker Headshot',
  ].map((p) => p.toLowerCase()),
);

export const STAGE2_DELEGATE_PROMPTS = new Set(
  SPEC_DELEGATE_STAGE2_PROMPTS.map((p) => p.toLowerCase()),
);

export const STAGE2_VENDOR_PROMPTS = new Set(
  SPEC_VENDOR_STAGE2_PROMPTS.map((p) => p.toLowerCase()),
);

export const DELEGATE_STAGE1_HIDDEN_PROMPTS = new Set(
  ['Username (create one to login in future)', 'Work Phone'].map((p) => p.toLowerCase()),
);

export const VENDOR_ALWAYS_HIDDEN_PROMPTS = new Set(
  [
    'Are you attending the event?',
    'Use Availability',
    'Number Diaries (maximum meetings per slot)',
    'Maximum Meetings',
    'Max Reps',
    'Max Hotel Days',
    "Available for 1-on-1's",
    'Approved status (Y/N/P)',
    'Company Logo URL',
    'Username',
    'Additional Information PDF URL',
    'Are you a minority owned organization?',
    'Specify your minority owned business',
    'Zip',
  ].map((p) => p.toLowerCase()),
);

export function normalizeRegistrationPrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function stage1SetForAudience(audience: MatchmakingAudience): Set<string> {
  if (audience === 'vendor') return STAGE1_VENDOR_PROMPTS;
  if (audience === 'user') return STAGE1_SPEAKER_PROMPTS;
  return STAGE1_DELEGATE_PROMPTS;
}

function stage2SetForAudience(audience: MatchmakingAudience): Set<string> {
  if (audience === 'vendor') return STAGE2_VENDOR_PROMPTS;
  return STAGE2_DELEGATE_PROMPTS;
}

export function isStage1RegistrationQuestion(audience: MatchmakingAudience, prompt: string): boolean {
  const norm = normalizeRegistrationPrompt(prompt);
  if (audience === 'attendee' && DELEGATE_STAGE1_HIDDEN_PROMPTS.has(norm)) return false;
  if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return false;
  return stage1SetForAudience(audience).has(norm);
}

export function isRegistrationQuestionHiddenByDefault(audience: MatchmakingAudience, prompt: string): boolean {
  const norm = normalizeRegistrationPrompt(prompt);
  if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return true;
  return !stage2SetForAudience(audience).has(norm);
}

export function isStage2RegistrationQuestion(
  audience: MatchmakingAudience,
  question: Pick<EventRegistrationQuestion, 'prompt' | 'is_hidden' | 'is_base_question'>,
): boolean {
  if (question.is_hidden) return false;
  const norm = normalizeRegistrationPrompt(question.prompt);
  if (norm === normalizeRegistrationPrompt(TERMS_ACCEPTANCE_PROMPT)) return false;
  if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return false;
  if (audience === 'vendor' && norm === 'company logo url') return false;
  if (question.is_base_question === false) return true;
  if (isSolutionCategoryInterestPrompt(question.prompt) || isHeadshotPrompt(question.prompt)) return true;
  return stage2SetForAudience(audience).has(norm);
}

export const DELEGATE_ALWAYS_HIDDEN_PROMPTS = DELEGATE_STAGE1_HIDDEN_PROMPTS;
