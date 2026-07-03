import type { MatchmakingAudience } from './types';

/** Prompts collected in the registration portal header grid — hide in the question list. */
export const REGISTRATION_TOP_GRID_PROMPTS = new Set(
  ['company name', 'first name', 'last name', 'e-mail address', 'email', 'job title'].map((p) => p.toLowerCase())
);

/** Prompts rendered in the registration portal header grid instead of the question list. */
export const REGISTRATION_HEADER_FIELD_PROMPTS = new Set(
  [...REGISTRATION_TOP_GRID_PROMPTS, 'cell phone']
);

/** Solution-provider category multi-selects — enable per event when running B2B matchmaking. */
const SOLUTION_CATEGORY_PROMPTS = new Set(
  [
    'Coaching',
    'Consulting & Services',
    'Culture, Engagement & Wellness',
    'Technologies',
    'Training',
    'Workforce & Leadership Development',
    'Compensation & Benefits',
    'Corporate Wellness Services',
    'Employee Relations',
    'Executive Training & Leadership Development',
    'HR Software & Technologies',
    'Learning & Development Training & Programs',
    'Organizational Culture',
    'Talent / Human Capital Management (HCM)',
    'Talent Acquisition & Management',
    'Other Provider Offerings Not Listed',
  ].map((p) => p.toLowerCase())
);

/** Delegate — never collect on public registration (sign-in uses email). */
export const DELEGATE_ALWAYS_HIDDEN_PROMPTS = new Set(
  ['Username (create one to login in future)', 'Work Phone'].map((p) => p.toLowerCase())
);

export const TERMS_ACCEPTANCE_PROMPT =
  'I have read and accept the Terms and Conditions and Code of Conduct';

/** Delegate (attendee) — shown on a lean default form for any event. */
const DELEGATE_VISIBLE_BY_DEFAULT = new Set(
  ['Cell Phone', TERMS_ACCEPTANCE_PROMPT].map((p) => p.toLowerCase())
);

/** Vendor — core profile + onsite/virtual logistics. */
const VENDOR_VISIBLE_BY_DEFAULT = new Set(
  [
    'Username',
    'Company Description',
    'Company Logo Image',
    'Company Website',
    'Are you sending representatives to the event onsite?',
    'Will your team take meetings virtually?',
  ].map((p) => p.toLowerCase())
);

/** Speaker — core profile + session materials. */
const SPEAKER_VISIBLE_BY_DEFAULT = new Set(
  [
    'Username (create one to login in future)',
    'Work Phone',
    'Cell Phone',
    'Speaker Bio',
    'Speaker Headshot',
    'I have read and accept the Terms and Conditions and Code of Conduct',
  ].map((p) => p.toLowerCase())
);

/** Legacy vendor ops fields — always suppressed (not optional per event). */
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
  ].map((p) => p.toLowerCase())
);

export function normalizeRegistrationPrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function visibleSetForAudience(audience: MatchmakingAudience): Set<string> {
  if (audience === 'vendor') return VENDOR_VISIBLE_BY_DEFAULT;
  if (audience === 'user') return SPEAKER_VISIBLE_BY_DEFAULT;
  return DELEGATE_VISIBLE_BY_DEFAULT;
}

/** Whether a base template question should start hidden (admins can show per event). */
export function isRegistrationQuestionHiddenByDefault(audience: MatchmakingAudience, prompt: string): boolean {
  const norm = normalizeRegistrationPrompt(prompt);
  if (REGISTRATION_TOP_GRID_PROMPTS.has(norm)) return true;
  if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return true;
  if (audience === 'attendee' && DELEGATE_ALWAYS_HIDDEN_PROMPTS.has(norm)) return true;
  if (SOLUTION_CATEGORY_PROMPTS.has(norm)) return true;
  return !visibleSetForAudience(audience).has(norm);
}
