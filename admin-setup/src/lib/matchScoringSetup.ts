import {
  isSolutionCategoryInterestPrompt,
  SOLUTION_CATEGORY_INTEREST_PROMPT,
  SOLUTION_CATEGORY_VENDOR_PROMPT,
  DELEGATE_SENIORITY_PROMPT,
  VENDOR_SENIORITY_PROMPT,
} from './specRegistrationQuestions';
import type { EventRegistrationForm, EventRegistrationQuestion } from './types';

export type MatchWeightKey =
  | 'weight_category'
  | 'weight_goals'
  | 'weight_seniority'
  | 'weight_revenue'
  | 'weight_budget'
  | 'weight_scope'
  | 'weight_semantic';

export type MatchConfigWeights = Record<MatchWeightKey, number>;

export const DEFAULT_MATCH_WEIGHTS: MatchConfigWeights = {
  weight_category: 40,
  weight_goals: 15,
  weight_seniority: 10,
  weight_revenue: 10,
  weight_budget: 10,
  weight_scope: 10,
  weight_semantic: 0,
};

export type ScoringDimensionId =
  | 'category'
  | 'goals'
  | 'seniority'
  | 'revenue'
  | 'budget'
  | 'scope'
  | 'shared_select'
  | 'semantic_text';

export type ScoringDimensionStatus = 'ready' | 'partial' | 'missing';

export interface ScoringQuestionRef {
  id: string;
  prompt: string;
  formName: string;
  audience: 'vendor' | 'attendee';
  questionType: string;
  usedInMatching: boolean;
}

export interface ScoringDimensionProposal {
  id: ScoringDimensionId;
  label: string;
  weightKey: MatchWeightKey;
  recommendedWeight: number;
  status: ScoringDimensionStatus;
  detail: string;
  vendorQuestions: ScoringQuestionRef[];
  delegateQuestions: ScoringQuestionRef[];
}

export interface MatchScoringSetupProposal {
  dimensions: ScoringDimensionProposal[];
  weights: MatchConfigWeights;
  /** Question IDs that should have used_in_matching = true after approve. */
  enableMatchingQuestionIds: string[];
  readyCount: number;
  partialCount: number;
  missingCount: number;
  summary: string;
}

type FormQuestion = EventRegistrationQuestion & { formName: string; audience: 'vendor' | 'attendee' };

function norm(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesAny(prompt: string, patterns: RegExp[]): boolean {
  const p = norm(prompt);
  return patterns.some((re) => re.test(p));
}

function toRef(q: FormQuestion): ScoringQuestionRef {
  return {
    id: q.id,
    prompt: q.prompt,
    formName: q.formName,
    audience: q.audience,
    questionType: q.question_type,
    usedInMatching: q.used_in_matching === true,
  };
}

const DIMENSION_SPECS: Array<{
  id: ScoringDimensionId;
  label: string;
  weightKey: MatchWeightKey;
  defaultWeight: number;
  vendorPatterns: RegExp[];
  delegatePatterns: RegExp[];
  /** Category also uses solution_categories sync; treat as ready if either side has category prompt. */
  eitherSideOk?: boolean;
}> = [
  {
    id: 'category',
    label: 'Solution categories',
    weightKey: 'weight_category',
    defaultWeight: 40,
    vendorPatterns: [/solution\/?vendor category/, /category you offer/],
    delegatePatterns: [/solution category of interest/, /categories? of interest/],
    eitherSideOk: true,
  },
  {
    id: 'goals',
    label: 'Meeting goals',
    weightKey: 'weight_goals',
    defaultWeight: 15,
    vendorPatterns: [/^meeting goals$/, /hoping to accomplish/],
    delegatePatterns: [/^meeting goals$/, /hoping to get from this event/],
  },
  {
    id: 'seniority',
    label: 'Seniority / level',
    weightKey: 'weight_seniority',
    defaultWeight: 10,
    vendorPatterns: [/seniority levels are you hoping to meet/, /seniority level/],
    delegatePatterns: [/^seniority level$/, /c-suite or report directly/],
  },
  {
    id: 'revenue',
    label: 'Revenue alignment',
    weightKey: 'weight_revenue',
    defaultWeight: 10,
    vendorPatterns: [/ideal customer.?s revenue/, /revenue range/],
    delegatePatterns: [/annual revenue/, /company.?s annual revenue/],
  },
  {
    id: 'budget',
    label: 'Budget alignment',
    weightKey: 'weight_budget',
    defaultWeight: 10,
    vendorPatterns: [/budget range you.?re hoping/, /buyer has for/],
    delegatePatterns: [/budget for external/, /budget for .*solutions/],
  },
  {
    id: 'scope',
    label: 'Scope / function',
    weightKey: 'weight_scope',
    defaultWeight: 10,
    vendorPatterns: [/functions\/scope/, /scope you.?re targeting/],
    delegatePatterns: [/^scope of responsibility$/, /scope of responsibility/],
  },
];

function collectFormQuestions(
  forms: EventRegistrationForm[],
  questions: EventRegistrationQuestion[],
): FormQuestion[] {
  const formById = new Map(forms.map((f) => [f.id, f]));
  const out: FormQuestion[] = [];
  for (const q of questions) {
    if (q.is_hidden) continue;
    const form = formById.get(q.form_id);
    if (!form || form.is_active === false) continue;
    if (form.audience !== 'vendor' && form.audience !== 'attendee') continue;
    out.push({
      ...q,
      formName: form.name || (form.audience === 'vendor' ? 'Vendor' : 'Delegate'),
      audience: form.audience,
    });
  }
  return out;
}

function isExcludedFromMatchingPrompt(prompt: string): boolean {
  const p = norm(prompt);
  return (
    /terms\s*(and|&)?\s*conditions/.test(p) ||
    /\b(t&c|tnc)\b/.test(p) ||
    /privacy\s*policy/.test(p) ||
    /\b(consent|waiver|liability|nda|non-?disclosure)\b/.test(p) ||
    /i have read and accept/.test(p) ||
    /code of conduct/.test(p) ||
    /agree to (the )?terms/.test(p)
  );
}

function findSharedSelectPairs(all: FormQuestion[]): ScoringDimensionProposal | null {
  const vendorSelects = all.filter(
    (q) =>
      q.audience === 'vendor' &&
      (q.question_type === 'multi_select' || q.question_type === 'single_select') &&
      !isSolutionCategoryInterestPrompt(q.prompt) &&
      !isExcludedFromMatchingPrompt(q.prompt) &&
      norm(q.prompt) !== 'meeting goals',
  );
  const delegateByNorm = new Map(
    all
      .filter(
        (q) =>
          q.audience === 'attendee' &&
          (q.question_type === 'multi_select' || q.question_type === 'single_select') &&
          !isExcludedFromMatchingPrompt(q.prompt),
      )
      .map((q) => [norm(q.prompt), q]),
  );

  const vendorQs: ScoringQuestionRef[] = [];
  const delegateQs: ScoringQuestionRef[] = [];
  for (const vq of vendorSelects) {
    const dq = delegateByNorm.get(norm(vq.prompt));
    if (!dq) continue;
    // Skip pairs already covered by named dimensions
    if (
      DIMENSION_SPECS.some(
        (spec) =>
          matchesAny(vq.prompt, spec.vendorPatterns) || matchesAny(dq.prompt, spec.delegatePatterns),
      )
    ) {
      continue;
    }
    vendorQs.push(toRef(vq));
    delegateQs.push(toRef(dq));
  }

  if (!vendorQs.length) return null;
  return {
    id: 'shared_select',
    label: 'Shared select questions',
    weightKey: 'weight_goals',
    recommendedWeight: 0,
    status: 'ready',
    detail: `${vendorQs.length} identically named select field${vendorQs.length === 1 ? '' : 's'} on both forms (overlap scoring).`,
    vendorQuestions: vendorQs,
    delegateQuestions: delegateQs,
  };
}

function findSemanticText(all: FormQuestion[]): ScoringDimensionProposal | null {
  // Only true open-text *goal* prompts — not company bios / priority laundry lists.
  const vendorText = all.filter(
    (q) =>
      q.audience === 'vendor' &&
      (q.question_type === 'textarea' || q.question_type === 'text') &&
      !isExcludedFromMatchingPrompt(q.prompt) &&
      /hoping to accomplish|what are you hoping to accomplish/i.test(q.prompt),
  );
  const delegateText = all.filter(
    (q) =>
      q.audience === 'attendee' &&
      (q.question_type === 'textarea' || q.question_type === 'text') &&
      !isExcludedFromMatchingPrompt(q.prompt) &&
      /hoping to get|what are you hoping to get/i.test(q.prompt),
  );
  if (!vendorText.length && !delegateText.length) return null;
  const status: ScoringDimensionStatus =
    vendorText.length && delegateText.length ? 'ready' : 'partial';
  return {
    id: 'semantic_text',
    label: 'Open-text goals (light)',
    weightKey: 'weight_semantic',
    recommendedWeight: status === 'ready' ? 5 : 0,
    status,
    detail:
      status === 'ready'
        ? 'Both sides have “hoping to…” goal answers. When AI themes are on, we turn those into short tags and score shared themes; otherwise we use shared words only.'
        : 'Only one side has open-text goal fields — left off until both exist.',
    vendorQuestions: vendorText.map(toRef),
    delegateQuestions: delegateText.map(toRef),
  };
}

/**
 * Inspect active vendor + delegate forms and propose deterministic scoring setup.
 * Admin approves; runtime scoring stays in SQL (no AI).
 */
export function proposeMatchScoringSetup(params: {
  forms: EventRegistrationForm[];
  questions: EventRegistrationQuestion[];
}): MatchScoringSetupProposal {
  const all = collectFormQuestions(params.forms, params.questions);
  const vendorQs = all.filter((q) => q.audience === 'vendor');
  const delegateQs = all.filter((q) => q.audience === 'attendee');

  const dimensions: ScoringDimensionProposal[] = [];
  const enableIds = new Set<string>();
  const weights: MatchConfigWeights = { ...DEFAULT_MATCH_WEIGHTS, weight_semantic: 0 };

  for (const spec of DIMENSION_SPECS) {
    const vHits = vendorQs.filter((q) => {
      if (spec.id === 'category') return isSolutionCategoryInterestPrompt(q.prompt);
      return matchesAny(q.prompt, spec.vendorPatterns);
    });
    const dHits = delegateQs.filter((q) => {
      if (spec.id === 'category') return isSolutionCategoryInterestPrompt(q.prompt);
      return matchesAny(q.prompt, spec.delegatePatterns);
    });

    // Also catch category by known prompts if helper missed renamed copy
    if (spec.id === 'category') {
      if (!vHits.length) {
        const alt = vendorQs.find((q) => norm(q.prompt) === norm(SOLUTION_CATEGORY_VENDOR_PROMPT));
        if (alt) vHits.push(alt);
      }
      if (!dHits.length) {
        const alt = delegateQs.find((q) => norm(q.prompt) === norm(SOLUTION_CATEGORY_INTEREST_PROMPT));
        if (alt) dHits.push(alt);
      }
    }
    if (spec.id === 'seniority') {
      if (!vHits.length) {
        const alt = vendorQs.find((q) => norm(q.prompt) === norm(VENDOR_SENIORITY_PROMPT));
        if (alt) vHits.push(alt);
      }
      if (!dHits.length) {
        const alt = delegateQs.find((q) => norm(q.prompt) === norm(DELEGATE_SENIORITY_PROMPT));
        if (alt) dHits.push(alt);
      }
    }

    let status: ScoringDimensionStatus = 'missing';
    if (vHits.length && dHits.length) status = 'ready';
    else if (spec.eitherSideOk && (vHits.length || dHits.length)) status = 'ready';
    else if (vHits.length || dHits.length) status = 'partial';

    const recommendedWeight = status === 'ready' ? spec.defaultWeight : 0;
    weights[spec.weightKey] = recommendedWeight;

    let detail = '';
    if (status === 'ready') {
      detail = `Ready — ${vHits.length ? 'vendor' : '—'}${vHits.length && dHits.length ? ' + ' : ''}${
        dHits.length ? 'delegate' : ''
      } fields found.`;
      if (spec.eitherSideOk && !(vHits.length && dHits.length)) {
        detail = 'Ready — category field found (synced into solution categories for scoring).';
      }
    } else if (status === 'partial') {
      detail = vHits.length
        ? 'Vendor field found, but no matching delegate field.'
        : 'Delegate field found, but no matching vendor field.';
    } else {
      detail = 'Not found on active vendor/delegate forms — weight set to 0.';
    }

    for (const q of [...vHits, ...dHits]) enableIds.add(q.id);

    dimensions.push({
      id: spec.id,
      label: spec.label,
      weightKey: spec.weightKey,
      recommendedWeight,
      status,
      detail,
      vendorQuestions: vHits.map(toRef),
      delegateQuestions: dHits.map(toRef),
    });
  }

  const shared = findSharedSelectPairs(all);
  if (shared) {
    dimensions.push(shared);
    for (const q of [...shared.vendorQuestions, ...shared.delegateQuestions]) enableIds.add(q.id);
    // Shared selects feed the goals/multi_select overlap bucket — bump goals slightly if goals otherwise 0
    if (weights.weight_goals === 0) {
      weights.weight_goals = 10;
      const goalsDim = dimensions.find((d) => d.id === 'goals');
      if (goalsDim && goalsDim.status !== 'ready') {
        goalsDim.recommendedWeight = 10;
        goalsDim.detail += ' Shared select overlap will use a goals weight of 10.';
      }
    }
  }

  const semantic = findSemanticText(all);
  if (semantic) {
    dimensions.push(semantic);
    weights.weight_semantic = semantic.recommendedWeight;
    if (semantic.status === 'ready') {
      for (const q of [...semantic.vendorQuestions, ...semantic.delegateQuestions]) {
        enableIds.add(q.id);
      }
    }
  }

  const readyCount = dimensions.filter((d) => d.status === 'ready').length;
  const partialCount = dimensions.filter((d) => d.status === 'partial').length;
  const missingCount = dimensions.filter((d) => d.status === 'missing').length;

  const activeWeightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const summary =
    vendorQs.length === 0 || delegateQs.length === 0
      ? 'Need at least one active vendor form and one active delegate form.'
      : `${readyCount} scoring signal${readyCount === 1 ? '' : 's'} ready · ${partialCount} partial · ${missingCount} missing · total weight ${activeWeightTotal}`;

  return {
    dimensions,
    weights,
    enableMatchingQuestionIds: Array.from(enableIds),
    readyCount,
    partialCount,
    missingCount,
    summary,
  };
}

export function weightsEqual(a: MatchConfigWeights, b: MatchConfigWeights): boolean {
  return (Object.keys(DEFAULT_MATCH_WEIGHTS) as MatchWeightKey[]).every((k) => a[k] === b[k]);
}

/** True when admin has approved the proposed weights and matching question flags. */
export function isMatchScoringSetupApproved(params: {
  forms: EventRegistrationForm[];
  questions: EventRegistrationQuestion[];
  currentWeights: MatchConfigWeights;
}): boolean {
  const proposal = proposeMatchScoringSetup({
    forms: params.forms,
    questions: params.questions,
  });
  if (proposal.readyCount === 0) return false;
  return (
    weightsEqual(params.currentWeights, proposal.weights) &&
    proposal.enableMatchingQuestionIds.every((id) =>
      params.questions.some((q) => q.id === id && q.used_in_matching === true),
    )
  );
}
