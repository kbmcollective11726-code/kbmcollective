/** Master Build Spec §5–§6 — delegate Stage 2 field prompts (normalized lowercase). */

export const SPEC_DELEGATE_STAGE2_PROMPTS = [
  'Company Name',
  'First Name',
  'Last Name',
  'Job Title',
  'E-Mail Address',
  'Work Phone',
  'Cell Phone',
  'How did you hear about this event?',
  'Dietary Restrictions',
  'Preferred Pronouns',
  'Address',
  'City',
  'State/Province',
  'Zip Code/Postal Code',
  'Country',
  'Assistant First Name',
  'Assistant Last Name',
  'Assistant Email',
  'Assistant Work Phone',
  "Company's Annual Revenue",
  'Select your budget for external solutions for 2026',
  'Scope of Responsibility',
  'I sit in the C-suite or report directly to the C-suite',
  'Name of person I report to',
  'Solution Category of Interest',
  'Meeting Goals',
  'What are you hoping to get from this event?',
  'Headshot/Photo',
] as const;

/** Master Build Spec §6 — vendor Stage 2 field prompts. */
export const SPEC_VENDOR_STAGE2_PROMPTS = [
  'Company Name',
  'First Name',
  'Last Name',
  'Job Title',
  'E-Mail Address',
  'Work Phone',
  'Cell Phone',
  'Address',
  'City',
  'State/Province',
  'Zip Code/Postal Code',
  'Country',
  'Company Description',
  'Company Logo Image',
  'Company Website',
  'Which seniority levels are you hoping to meet with?',
  "Ideal customer's revenue range",
  "Budget range you're hoping your buyer has for 2026",
  "Functions/scope you're targeting",
  'Solution/Vendor Category You Offer',
  'Meeting Goals',
  'What are you hoping to accomplish at this event?',
  'Headshot/Photo',
  'Are you sending representatives to the event onsite?',
  'Will your team take meetings virtually?',
] as const;

export const MEETING_GOALS_DELEGATE_OPTIONS = [
  'Evaluating solutions to purchase in the next 6 months',
  'Researching for a future budget cycle',
  'Open to learning about new vendors',
  'Exploring strategic partnerships',
  'Networking / relationship-building only',
  "Sharing my organization's expertise",
  'Other',
];

export const MEETING_GOALS_VENDOR_OPTIONS = [
  'Generate new leads',
  'Deepen existing relationships',
  'Brand awareness',
  'Recruit partners',
  'Other',
];

export const VENDOR_SENIORITY_OPTIONS = [
  'C-Suite',
  'SVP/VP',
  'Director',
  'Manager',
  'Individual Contributor',
];

export const VENDOR_REVENUE_OPTIONS = [
  'Under $10M',
  '$10M–$50M',
  '$50M–$250M',
  '$250M–$1B',
  'Over $1B',
];

export const VENDOR_BUDGET_OPTIONS = [
  'Under $50K',
  '$50K–$250K',
  '$250K–$1M',
  'Over $1M',
  'Not yet determined',
];

export const VENDOR_SCOPE_OPTIONS = [
  'Global/Enterprise-wide',
  'Regional',
  'Departmental/Business unit',
  'Team-level',
  'Individual contributor only',
];

/** Legacy KBM template blocks removed from Stage 2 (spec-aligned trim). */
export const LEGACY_DELEGATE_STAGE2_HIDDEN_PROMPTS = [
  'Username (create one to login in future)',
  'Please list your top 5 human resources, total rewards, and corporate wellness priorities for 2026',
  'Please list your top 5 Culture, Engagement, and DE&I priorities for 2026',
  'What challenges are you facing, regarding achieving these objectives?',
  'Please select the time frame below that best represents the plan to achieve these objectives?',
  'Total number of employees globally',
  'Does your organization provide a tuition assistance benefit?',
  'If yes, what amount?',
  "How does formal education fit into your organization's culture of learning?",
  'Which technologies/solutions are you presently utilizing for your human resources and total rewards initiatives?',
  'Which technologies or solutions are you currently utilizing for your DE&I and/or Culture & Engagement initiatives?',
  'Which technologies/solutions are you presently looking to change/upgrade?',
  'Are you looking to maximize your DE&I strategy with data and analytics?',
  'Are you (or someone who reports to you) responsible for managing your company-wide employee survey program?',
  'If Yes: When would you be willing to consider a new employee survey partner?',
  'Do you or anyone in your department manage compliance requirements for labor law posters, digital postings for remote workers, mandatory employee notifications, and related requirements?',
  "Are you responsible for managing your company's rewards and benefits?",
  'Are you interested in a solution that makes it easy to create short-form, TikTok-style videos to improve employee experience — from onboarding and training to recognition and employee communication?',
  'Are you a minority owned organization?',
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
] as const;

export const SOLUTION_CATEGORY_INTEREST_PROMPT = 'Solution Category of Interest';
export const SOLUTION_CATEGORY_VENDOR_PROMPT = 'Solution/Vendor Category You Offer';

export function isSolutionCategoryInterestPrompt(prompt: string): boolean {
  const norm = prompt.trim().toLowerCase();
  return (
    norm === SOLUTION_CATEGORY_INTEREST_PROMPT.toLowerCase() ||
    norm === SOLUTION_CATEGORY_VENDOR_PROMPT.toLowerCase()
  );
}

export function isHeadshotPrompt(prompt: string): boolean {
  return prompt.trim().toLowerCase() === 'headshot/photo';
}
