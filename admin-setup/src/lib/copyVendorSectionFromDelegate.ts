import type { EventRegistrationQuestion, MatchmakingAudience } from './types';
import { resolveRegistrationSectionLabel } from './registrationSectionLabels';
import {
  SOLUTION_CATEGORY_INTEREST_PROMPT,
  SOLUTION_CATEGORY_VENDOR_PROMPT,
} from './specRegistrationQuestions';

/** Vendor sections that can pull matching content from a delegate form. */
export const VENDOR_COPY_FROM_DELEGATE_SECTIONS = new Set(['Solution interest (vendor)']);

/** Delegate sections to read when copying into each vendor section. */
export const DELEGATE_SECTIONS_FOR_VENDOR_TARGET: Record<string, string[]> = {
  'Solution interest (vendor)': ['Solution interest'],
};

const DELEGATE_TO_VENDOR_PROMPT_PAIRS: Array<[string, string]> = [
  [SOLUTION_CATEGORY_INTEREST_PROMPT, SOLUTION_CATEGORY_VENDOR_PROMPT],
];

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function canonicalSectionLabel(sectionLabel: string | null | undefined): string {
  const label = (sectionLabel ?? '').trim() || 'General';
  if (/^solution provider categories$/i.test(label) || /^solution providers categories$/i.test(label)) {
    return 'Solution providers categories';
  }
  if (/^meeting preferences(?:\s*&\s*matching)?$/i.test(label)) {
    return 'Meeting preferences';
  }
  if (/^profile(?:\s*&\s*event logistics)?$/i.test(label)) {
    return 'Identity & contact';
  }
  return label;
}

function questionInSection(
  question: EventRegistrationQuestion,
  sectionLabel: string,
  audience: MatchmakingAudience,
): boolean {
  const resolved = resolveRegistrationSectionLabel(question, audience);
  return canonicalSectionLabel(resolved) === canonicalSectionLabel(sectionLabel);
}

export function collectDelegateQuestionsForVendorCopy(
  delegateQuestions: EventRegistrationQuestion[],
  sourceSectionLabels: string[],
): EventRegistrationQuestion[] {
  const wanted = new Set(sourceSectionLabels.map((s) => canonicalSectionLabel(s).toLowerCase()));
  return delegateQuestions
    .filter((q) => {
      const resolved = resolveRegistrationSectionLabel(q, 'attendee');
      return wanted.has(canonicalSectionLabel(resolved).toLowerCase());
    })
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt));
}

export function findVendorQuestionMatch(
  delegateQuestion: EventRegistrationQuestion,
  vendorQuestions: EventRegistrationQuestion[],
): EventRegistrationQuestion | undefined {
  const delegateNorm = normalizePrompt(delegateQuestion.prompt);
  for (const [from, to] of DELEGATE_TO_VENDOR_PROMPT_PAIRS) {
    if (delegateNorm === normalizePrompt(from)) {
      const vendorNorm = normalizePrompt(to);
      return vendorQuestions.find((q) => normalizePrompt(q.prompt) === vendorNorm);
    }
  }
  return vendorQuestions.find((q) => normalizePrompt(q.prompt) === delegateNorm);
}

export function vendorQuestionsInSection(
  vendorQuestions: EventRegistrationQuestion[],
  sectionLabel: string,
): EventRegistrationQuestion[] {
  return vendorQuestions.filter((q) => questionInSection(q, sectionLabel, 'vendor'));
}

export function nextSortOrderInSection(
  vendorQuestions: EventRegistrationQuestion[],
  sectionLabel: string,
): number {
  const inSection = vendorQuestionsInSection(vendorQuestions, sectionLabel);
  if (inSection.length === 0) return 0;
  return Math.max(...inSection.map((q) => q.sort_order)) + 1;
}

export function describeVendorCopyPlan(
  delegateQuestions: EventRegistrationQuestion[],
  vendorQuestions: EventRegistrationQuestion[],
  vendorTargetSection: string,
): { syncCount: number; addCount: number; sourceCount: number } {
  const sourceSections = DELEGATE_SECTIONS_FOR_VENDOR_TARGET[vendorTargetSection] ?? [];
  const sources = collectDelegateQuestionsForVendorCopy(delegateQuestions, sourceSections);
  let syncCount = 0;
  let addCount = 0;
  for (const src of sources) {
    const match = findVendorQuestionMatch(src, vendorQuestions);
    if (match) syncCount += 1;
    else if (!src.is_base_question) addCount += 1;
  }
  return { syncCount, addCount, sourceCount: sources.length };
}
