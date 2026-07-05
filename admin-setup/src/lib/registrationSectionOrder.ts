import type { EventRegistrationForm, EventRegistrationQuestion, MatchmakingAudience } from './types';
import {
  DELEGATE_REGISTRATION_SECTION_ORDER,
  resolveRegistrationSectionLabel,
} from './registrationSectionLabels';

export function parseSectionOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function defaultSectionOrderForAudience(audience: MatchmakingAudience): string[] {
  if (audience === 'attendee') return [...DELEGATE_REGISTRATION_SECTION_ORDER];
  return [];
}

export function sectionLabelsFromQuestions(
  audience: MatchmakingAudience,
  questions: EventRegistrationQuestion[],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const q of questions) {
    const label = resolveRegistrationSectionLabel(q, audience);
    if (label === 'General' || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** Effective section order: stored order, else defaults + custom labels from questions. */
export function mergeSectionOrder(
  form: Pick<EventRegistrationForm, 'audience' | 'section_order'>,
  questions: EventRegistrationQuestion[],
): string[] {
  const stored = parseSectionOrder(form.section_order);
  const fromQuestions = sectionLabelsFromQuestions(form.audience, questions);
  const defaults = defaultSectionOrderForAudience(form.audience);

  const base = stored.length > 0 ? [...stored] : [...defaults];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const label of base) {
    if (label === 'General' || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  for (const label of fromQuestions) {
    if (label === 'General' || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

export function addSectionToOrder(order: string[], sectionLabel: string): string[] {
  const label = sectionLabel.trim();
  if (!label || label === 'General') return order;
  if (order.some((item) => item.toLowerCase() === label.toLowerCase())) return order;
  return [...order, label];
}

export function renameSectionInOrder(order: string[], fromLabel: string, toLabel: string): string[] {
  const to = toLabel.trim();
  if (!to) return order;
  return order.map((item) => (item === fromLabel ? to : item));
}

export function removeSectionFromOrder(order: string[], sectionLabel: string): string[] {
  return order.filter((item) => item !== sectionLabel);
}

export function moveSectionInOrder(order: string[], sectionLabel: string, dir: -1 | 1): string[] {
  const idx = order.indexOf(sectionLabel);
  if (idx < 0) return order;
  const next = idx + dir;
  if (next < 0 || next >= order.length) return order;
  const copy = [...order];
  const [item] = copy.splice(idx, 1);
  if (!item) return order;
  copy.splice(next, 0, item);
  return copy;
}

export function sectionOrderIndex(order: string[], sectionLabel: string): number {
  const idx = order.indexOf(sectionLabel);
  return idx < 0 ? order.length + 1 : idx;
}
