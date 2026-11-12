import type { EventRegistrationForm, EventRegistrationQuestion, MatchmakingAudience } from './types';
import {
  DELEGATE_REGISTRATION_SECTION_ORDER,
  resolveRegistrationSectionLabel,
} from './registrationSectionLabels';

const STAGE1_SECTION = 'Stage 1 registration';
const LOGISTICS_SECTION = 'Logistics';

/** Default vendor form section order — Logistics last (before terms). */
export const VENDOR_REGISTRATION_SECTION_ORDER = [
  'Registration',
  'Identity & contact',
  'Company information',
  'Solution Provider profile (app)',
  'Target audience & ideal customer profile',
  'Solution interest (vendor)',
  'Meeting preferences',
  'Logistics',
] as const;

export function parseSectionOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function defaultSectionOrderForAudience(audience: MatchmakingAudience): string[] {
  if (audience === 'attendee') return [...DELEGATE_REGISTRATION_SECTION_ORDER];
  if (audience === 'vendor') return [...VENDOR_REGISTRATION_SECTION_ORDER];
  return [];
}

function isStage1Section(label: string): boolean {
  return label.trim().toLowerCase() === STAGE1_SECTION.toLowerCase();
}

export function sectionLabelsFromQuestions(
  audience: MatchmakingAudience,
  questions: EventRegistrationQuestion[],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const q of questions) {
    const label = resolveRegistrationSectionLabel(q, audience);
    if (label === 'General' || seen.has(label) || isStage1Section(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/**
 * Effective section order for public forms + portals.
 * Prefer Matchmaking-stored section_order; fill gaps from defaults/questions.
 * Stage 1 / terms always stays last. Logistics defaults to bottom of content.
 */
export function mergeSectionOrder(
  form: Pick<EventRegistrationForm, 'audience' | 'section_order'>,
  questions: EventRegistrationQuestion[],
): string[] {
  const stored = parseSectionOrder(form.section_order);
  const fromQuestions = sectionLabelsFromQuestions(form.audience, questions);
  const defaults = defaultSectionOrderForAudience(form.audience);
  const hasStage1 = questions.some((q) => isStage1Section(resolveRegistrationSectionLabel(q, form.audience)));

  // Matchmaking order wins when set; otherwise audience defaults.
  const base = stored.length > 0 ? [...stored] : [...defaults];
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === 'General' || isStage1Section(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  for (const label of base) push(label);
  // Only fill gaps from questions actually on the form (custom sections, etc.).
  for (const label of fromQuestions) push(label);

  // When no Matchmaking order is saved yet, put Registration first and Logistics last.
  if (stored.length === 0) {
    const registrationIdx = result.findIndex((l) => l.toLowerCase() === 'registration');
    if (registrationIdx > 0) {
      const [registration] = result.splice(registrationIdx, 1);
      if (registration) result.unshift(registration);
    }
    const logisticsIdx = result.findIndex((l) => l.toLowerCase() === LOGISTICS_SECTION.toLowerCase());
    if (logisticsIdx >= 0 && logisticsIdx !== result.length - 1) {
      const [logistics] = result.splice(logisticsIdx, 1);
      if (logistics) result.push(logistics);
    }
  }

  if (hasStage1) result.push(STAGE1_SECTION);
  return result;
}

export function addSectionToOrder(order: string[], sectionLabel: string): string[] {
  const label = sectionLabel.trim();
  if (!label || label === 'General' || isStage1Section(label)) return order;
  if (order.some((item) => item.toLowerCase() === label.toLowerCase())) return order;

  // Keep Stage 1 last if present; insert new sections (incl. Logistics) before it.
  const stageIdx = order.findIndex((item) => isStage1Section(item));
  if (stageIdx >= 0) {
    const copy = [...order];
    copy.splice(stageIdx, 0, label);
    return copy;
  }
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
  // Don't move content sections below Stage 1 terms.
  if (isStage1Section(order[next] ?? '')) return order;
  if (isStage1Section(sectionLabel)) return order;
  const copy = [...order];
  const [item] = copy.splice(idx, 1);
  if (!item) return order;
  copy.splice(next, 0, item);
  return copy;
}

/** Move a section to another section's position (drag-and-drop). */
export function reorderSectionInOrder(order: string[], fromLabel: string, toLabel: string): string[] {
  if (fromLabel === toLabel) return order;
  const fromIdx = order.indexOf(fromLabel);
  const toIdx = order.indexOf(toLabel);
  if (fromIdx < 0 || toIdx < 0) return order;
  if (isStage1Section(fromLabel) || isStage1Section(toLabel)) return order;
  const copy = [...order];
  const [item] = copy.splice(fromIdx, 1);
  if (!item) return order;
  copy.splice(toIdx, 0, item);
  return copy;
}

export function sectionOrderIndex(order: string[], sectionLabel: string): number {
  const idx = order.indexOf(sectionLabel);
  return idx < 0 ? order.length + 1 : idx;
}
