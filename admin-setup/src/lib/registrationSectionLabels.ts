import type { EventRegistrationQuestion, MatchmakingAudience } from './types';
import { normalizeRegistrationPrompt } from './registrationDefaultVisibility';

/** Display order for delegate Registration Details sections. */
export const DELEGATE_REGISTRATION_SECTION_ORDER = [
  'Registration',
  'Identity & contact',
  'Company information',
  'Eligibility & buying intent',
  'Solution interest',
  'Meeting preferences',
  'Logistics',
] as const;

/** Top-of-form account fields shown in the public registration header grid. */
export const REGISTRATION_SECTION_LABEL = 'Registration';

type SectionEntry = { prompt: string; section?: string };

function buildPromptSectionMap(entries: SectionEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  let current = 'General';
  for (const entry of entries) {
    if (entry.section) current = entry.section;
    map.set(normalizeRegistrationPrompt(entry.prompt), current);
  }
  return map;
}

const DELEGATE_SECTION_ENTRIES: SectionEntry[] = [
  { prompt: 'First Name', section: REGISTRATION_SECTION_LABEL },
  { prompt: 'Last Name' },
  { prompt: 'E-Mail Address' },
  { prompt: 'Company Name' },
  { prompt: 'Job Title' },
  { prompt: 'Cell Phone' },
  { prompt: 'Work Phone', section: 'Identity & contact' },
  { prompt: 'How did you hear about this event?' },
  { prompt: 'Dietary Restrictions' },
  { prompt: 'Preferred Pronouns' },
  { prompt: 'Headshot/Photo' },
  { prompt: 'Address', section: 'Company information' },
  { prompt: 'City' },
  { prompt: 'State/Province' },
  { prompt: 'Zip Code/Postal Code' },
  { prompt: 'Country' },
  { prompt: 'Assistant First Name' },
  { prompt: 'Assistant Last Name' },
  { prompt: 'Assistant Email' },
  { prompt: 'Assistant Work Phone' },
  { prompt: "Company's Annual Revenue", section: 'Eligibility & buying intent' },
  { prompt: 'Total number of employees globally' },
  { prompt: 'Select your budget for external solutions for 2026' },
  { prompt: 'Scope of Responsibility' },
  { prompt: 'Seniority Level' },
  { prompt: 'Name of person I report to' },
  { prompt: 'Solution Category of Interest', section: 'Solution interest' },
  { prompt: 'Meeting Goals', section: 'Meeting preferences' },
  { prompt: 'What are you hoping to get from this event?' },
];

const DELEGATE_PROMPT_SECTION_MAP = buildPromptSectionMap(DELEGATE_SECTION_ENTRIES);

/** Map legacy DB section labels to current display names. */
const LEGACY_SECTION_ALIASES: Record<string, string> = {
  'meeting preferences & matching': 'Meeting preferences',
  'profile & event logistics': 'Identity & contact',
  profile: 'Identity & contact',
  'registration details': REGISTRATION_SECTION_LABEL,
};

export function resolveRegistrationSectionLabel(
  question: Pick<EventRegistrationQuestion, 'prompt' | 'section_label'>,
  audience: MatchmakingAudience,
): string {
  const norm = normalizeRegistrationPrompt(question.prompt);
  // Header-grid fields always belong under Registration (public form top block).
  if (
    norm === 'company name' ||
    norm === 'first name' ||
    norm === 'last name' ||
    norm === 'job title' ||
    norm === 'e-mail address' ||
    norm === 'email' ||
    norm === 'cell phone'
  ) {
    return REGISTRATION_SECTION_LABEL;
  }
  // Always keep headshot with identity fields, even if an older section_label lingers in DB.
  if (norm === 'headshot/photo') {
    return 'Identity & contact';
  }
  // Reviewed with revenue and budget when qualifying a registration.
  if (norm === 'total number of employees globally' && audience === 'attendee') {
    return 'Eligibility & buying intent';
  }
  const fromDb = (question.section_label ?? '').trim();
  if (fromDb) {
    const alias = LEGACY_SECTION_ALIASES[fromDb.toLowerCase()];
    return alias ?? fromDb;
  }
  if (audience === 'attendee') {
    return DELEGATE_PROMPT_SECTION_MAP.get(norm) ?? 'General';
  }
  return 'General';
}

export function groupQuestionsBySection(
  audience: MatchmakingAudience,
  questions: EventRegistrationQuestion[],
  options?: { sectionOrder?: string[]; includeEmptySections?: boolean },
): Array<{ sectionLabel: string; questions: EventRegistrationQuestion[] }> {
  const grouped = new Map<string, EventRegistrationQuestion[]>();

  for (const q of questions) {
    const label = resolveRegistrationSectionLabel(q, audience);
    const list = grouped.get(label) ?? [];
    list.push(q);
    grouped.set(label, list);
  }

  const orderList =
    options?.sectionOrder && options.sectionOrder.length > 0
      ? options.sectionOrder
      : [...DELEGATE_REGISTRATION_SECTION_ORDER];

  const orderIndex = new Map<string, number>(orderList.map((label, idx) => [label, idx]));

  const labels = new Set<string>([...grouped.keys()]);
  if (options?.includeEmptySections) {
    orderList.forEach((label) => labels.add(label));
  }

  return [...labels]
    .filter((label) => label !== 'General' || grouped.has('General'))
    .sort((a, b) => {
      const ai = orderIndex.get(a) ?? 999;
      const bi = orderIndex.get(b) ?? 999;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    })
    .map((sectionLabel) => ({
      sectionLabel,
      questions: (grouped.get(sectionLabel) ?? []).slice().sort((a, b) => {
        // Match Matchmaking admin: sort_order within the section (no special-case reordering).
        return a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt);
      }),
    }))
    .filter((group) => options?.includeEmptySections || group.questions.length > 0);
}
