import type { MatchmakingAudience } from './types';

export type SolutionCategoryAudience = 'attendee' | 'vendor';

export function solutionCategoryAudienceForForm(
  audience: MatchmakingAudience,
): SolutionCategoryAudience {
  return audience === 'vendor' ? 'vendor' : 'attendee';
}
export const DEFAULT_SOLUTION_CATEGORIES = [
  'Technology & Software',
  'Marketing & Communications',
  'Financial Services & Consulting',
  'Talent, HR & Workforce Solutions',
  'Sales & Customer Experience',
  'Legal, Risk & Compliance',
  'Operations & Supply Chain',
  'Leadership & Professional Development',
  'Sustainability & ESG',
  'Event & Meeting Services',
] as const;

/** Previous default set — hidden when migrating events to the cross-vertical starter list. */
export const LEGACY_DEFAULT_SOLUTION_CATEGORIES = [
  'Technologies',
  'Learning & Development',
  'Culture & Engagement',
  'Talent Acquisition',
  'HR Software',
  'Coaching',
  'Consulting',
  'Compensation & Benefits',
  'Organizational Culture',
  'Workforce & Leadership',
  'Executive Leadership',
  'Corporate Wellness',
] as const;

export type DefaultSolutionCategory = (typeof DEFAULT_SOLUTION_CATEGORIES)[number];
