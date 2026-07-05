import type { EventRegistrationQuestion, MatchmakingAudience } from './types';
import { normalizeRegistrationPrompt } from './registrationDefaultVisibility';

/** Display order for delegate Registration Details sections. */
export const DELEGATE_REGISTRATION_SECTION_ORDER = [
  'Identity & contact',
  'Company information',
  'Eligibility & buying intent',
  'Solution interest',
  'Meeting preferences',
  'Profile',
] as const;

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
  { prompt: 'Company Name', section: 'Identity & contact' },
  { prompt: 'First Name' },
  { prompt: 'Last Name' },
  { prompt: 'Job Title' },
  { prompt: 'E-Mail Address' },
  { prompt: 'Work Phone' },
  { prompt: 'Cell Phone' },
  { prompt: 'How did you hear about this event?' },
  { prompt: 'Dietary Restrictions' },
  { prompt: 'Preferred Pronouns' },
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
  { prompt: 'Select your budget for external solutions for 2026' },
  { prompt: 'Scope of Responsibility' },
  { prompt: 'I sit in the C-suite or report directly to the C-suite' },
  { prompt: 'Name of person I report to' },
  { prompt: 'Solution Category of Interest', section: 'Solution interest' },
  { prompt: 'Meeting Goals', section: 'Meeting preferences' },
  { prompt: 'What are you hoping to get from this event?' },
  { prompt: 'Headshot/Photo', section: 'Profile' },
];

const DELEGATE_PROMPT_SECTION_MAP = buildPromptSectionMap(DELEGATE_SECTION_ENTRIES);

/** Map legacy DB section labels to current display names. */
const LEGACY_SECTION_ALIASES: Record<string, string> = {
  'meeting preferences & matching': 'Meeting preferences',
  'profile & event logistics': 'Profile',
};

export function resolveRegistrationSectionLabel(
  question: Pick<EventRegistrationQuestion, 'prompt' | 'section_label'>,
  audience: MatchmakingAudience,
): string {
  const fromDb = (question.section_label ?? '').trim();
  if (fromDb) {
    const alias = LEGACY_SECTION_ALIASES[fromDb.toLowerCase()];
    return alias ?? fromDb;
  }
  if (audience === 'attendee') {
    return DELEGATE_PROMPT_SECTION_MAP.get(normalizeRegistrationPrompt(question.prompt)) ?? 'General';
  }
  return 'General';
}

export function groupQuestionsBySection(
  audience: MatchmakingAudience,
  questions: EventRegistrationQuestion[],
): Array<{ sectionLabel: string; questions: EventRegistrationQuestion[] }> {
  const orderIndex = new Map<string, number>(
    DELEGATE_REGISTRATION_SECTION_ORDER.map((label, idx) => [label, idx]),
  );
  const grouped = new Map<string, EventRegistrationQuestion[]>();

  for (const q of questions) {
    const label = resolveRegistrationSectionLabel(q, audience);
    const list = grouped.get(label) ?? [];
    list.push(q);
    grouped.set(label, list);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => {
      const ai = orderIndex.get(a) ?? 999;
      const bi = orderIndex.get(b) ?? 999;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    })
    .map(([sectionLabel, sectionQuestions]) => ({ sectionLabel, questions: sectionQuestions }));
}
