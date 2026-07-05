import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type {
  Event,
  EventMatchReview,
  EventMatchScheduledMeeting,
  EventMeetingInterestRequest,
  EventRegistrationAnswer,
  EventRegistrationForm,
  EventRegistrationQuestionOption,
  EventRegistrationQuestion,
  EventRegistrationSubmission,
  MatchmakingAudience,
  MatchmakingQuestionType,
} from '../lib/types';
import {
  isRegistrationQuestionHiddenByDefault,
  normalizeRegistrationPrompt,
  REGISTRATION_HEADER_FIELD_PROMPTS,
  VENDOR_ALWAYS_HIDDEN_PROMPTS,
} from '../lib/registrationDefaultVisibility';
import { publicPortalLoginUrl, publicRegisterUrl } from '../lib/publicPortalUrl';
import { sendRegistrationSetupEmail } from '../lib/registrationSetupEmail';
import { uploadEventImage } from '../lib/uploadEventImage';
import { interestLevelLabel } from '../lib/meetingRequests';
import {
  PORTAL_BANNER_FILE_ACCEPT,
  PORTAL_BANNER_HINT,
  PORTAL_BANNER_SIZE_LABEL,
} from '../lib/portalBannerHints';
import MatchmakingSolutionCategories from '../components/MatchmakingSolutionCategories';
import {
  LEGACY_DELEGATE_STAGE2_HIDDEN_PROMPTS,
  MEETING_GOALS_DELEGATE_OPTIONS,
  MEETING_GOALS_VENDOR_OPTIONS,
  SOLUTION_CATEGORY_INTEREST_PROMPT,
  SOLUTION_CATEGORY_VENDOR_PROMPT,
  VENDOR_BUDGET_OPTIONS,
  VENDOR_REVENUE_OPTIONS,
  VENDOR_SCOPE_OPTIONS,
  VENDOR_SENIORITY_OPTIONS,
} from '../lib/specRegistrationQuestions';
import {
  addSectionToOrder,
  defaultSectionOrderForAudience,
  mergeSectionOrder,
  moveSectionInOrder,
  removeSectionFromOrder,
  renameSectionInOrder,
} from '../lib/registrationSectionOrder';
import styles from './EventMatchmaking.module.css';

interface MatchConfigWeights {
  weight_category: number;
  weight_goals: number;
  weight_seniority: number;
  weight_revenue: number;
  weight_budget: number;
  weight_scope: number;
  weight_semantic: number;
}

const DEFAULT_MATCH_CONFIG: MatchConfigWeights = {
  weight_category: 40,
  weight_goals: 15,
  weight_seniority: 10,
  weight_revenue: 10,
  weight_budget: 10,
  weight_scope: 10,
  weight_semantic: 5,
};

type RankedMatch = {
  candidate: EventRegistrationSubmission;
  score: number;
  overlap: number;
  review: EventMatchReview | null;
  meetingRequest: EventMeetingInterestRequest | null;
  requestRank: number | null;
};

const QUESTION_TYPE_OPTIONS: MatchmakingQuestionType[] = [
  'text',
  'textarea',
  'single_select',
  'multi_select',
  'boolean',
  'number',
  'email',
];

type TemplateQuestion = {
  prompt: string;
  question_type: MatchmakingQuestionType;
  is_required?: boolean;
  options?: string[];
  section_label?: string;
};

const COMMON_SELECT_OPTIONS = {
  employeeCount: ['Less than 1,000', '1,000+', '5,000+', '10,000+', '20,000+', '50,000+', '100,000+'],
  timeframe: ['0 - 6 months', '7 - 12 months', '13 - 18 months', '18+ months'],
  annualRevenue: ['Under $10M', '$10M–$50M', '$50M–$250M', '$250M–$1B', 'Over $1B'],
  budget2026: ['Under $50K', '$50K–$250K', '$250K–$1M', 'Over $1M', 'Not yet determined'],
  scope: ['Global/Enterprise-wide', 'Regional', 'Departmental/Business unit', 'Team-level', 'Individual contributor only'],
  yesNo: ['Yes', 'No'],
  tuitionAmount: ['$1,000+', '$2,500+', '$5,000+', '$10,000+', '$15,000+'],
  surveySwitchWindow: ['Now', 'Within 6mo', 'Within 12mo', 'Not now. We are under contract for the next 1-2 years.', 'Not now. We are happy with our current provider.'],
  hearAboutEvent: ['Email invitation', 'Colleague referral', 'Company invitation', 'LinkedIn / social media', 'Web search', 'Other'],
  dietaryRestrictions: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Kosher', 'Halal', 'Other'],
  pronouns: ['She/Her', 'He/Him', 'They/Them', 'Prefer not to say', 'Other'],
};

const CATEGORY_OPTIONS = {
  coaching: ['Automated Coaching', 'Coaching as a Leadership Capability', 'Executive Coaching', 'In-Person Coaching', 'Integrated Coaching', 'Sales Coaching', 'Team Coaching', 'Virtual Coaching', 'N/A'],
  consulting: ['Affirmative Action / EEO', 'Candidate Marketing', 'Culture Analytics Program', 'DEI Strategic Planning', 'Diversity Recruiting', 'Employment Law & Compliance', 'Equal Pay Wage & Salary Administration', 'HR Compliance / Workplace Issues', 'Labor Relations & Legal Services', 'Organizational Behavioral Management', 'N/A'],
  cultureWellness: ['Corporate Sustainability/ESG', 'ERG Management', 'ERG Platform', 'Psychological Safety', 'Rewards & Recognition Programs', 'Stress Management', 'Volunteer Programs', 'Wellness Programs', 'Work / Life Balance Initiatives', 'N/A'],
  technologies: ['Adaptive Learning', 'Applicant Tracking System', 'Artificial Intelligence / Machine Learning', 'Augmented Reality / Virtual Reality', 'Company Culture Platform', 'Embedded Learning', 'Employee Engagement Software', 'Gamification', 'Knowledge Management System', 'Learning Experience Platform (LXP)', 'Learning Management System (LMS)', 'LMS Consulting or Support', 'Microlearning', 'Mobile Learning', 'People Analytics', 'Real-Time Learning', 'Recruiting / Candidate Experience Software', 'Social Learning', 'Text-Message Learning', 'Upskilling and Reskilling Software', 'Video Learning', 'N/A'],
  training: ['Anti-Harassment', 'Compliance', 'Emotional Intelligence', 'Executive Development', 'Experiential Learning', 'Neuroleadership', 'Unconscious Bias', 'Virtual Classroom', 'N/A'],
  workforceLeadership: ['BIPOC Focused Leadership Programs', 'Business - Education Partnerships', 'ERG Management', 'Executive Level Development', 'LGBTQ+ Focused Leadership Programs', 'Mentoring Programs', 'Rewards & Recognition Programs', 'Virtual Leadership Coaching', 'Women-Focused Leadership Programs', 'N/A'],
  compensationBenefits: ['Child / Dependent / Elder Care', 'End-to-End Total Rewards', 'Fertility Benefits / Family Planning', 'Health Care Cost Containment', 'High Impact Benefit', 'Hybrid Workplace Solutions', 'ERISA Wrap and HIPPA', 'Flex Plan / COBRA / FMLA Administration', 'College Savings', 'Portfolio Management & Resource Allocation', 'Travel & Relocation Services', 'Wage & Salary Management / Administration', 'Non-traditional Benefit', 'Short Term / Long Term Disability Plans', 'Telehealth / Telemedicine', 'Tuition Reimbursement / Educational Assistance', 'Wellness Programs', 'Work/Life Balance Initiatives', 'N/A'],
  corporateWellnessServices: ['Financial Wellness Solutions', 'Mental Health / Mental Wellbeing Programs', 'Nutrition / Weight Management', 'Physical Wellness Programs / Initiatives', 'Stress/Emotional Health Management / Programs', 'Wellbeing Programs', 'Wellness Campaign Providers', 'Wellness Management', 'Wellness Portals', 'Work/Life Balance Initiatives', 'N/A'],
  employeeRelations: ['Affirmative Action / EEO', 'Arbitration / Medication / Dispute Resolution', 'Employment Law & Compliance', 'Labor & Legal Services', 'Union Relations & Services', 'Workplace Behavior Analysis', 'N/A'],
  executiveLeadership: ['Executive & C-Suite Transition Labs', 'Executive Level Development', 'Immersive Leadership Programs', 'Leadership Behavior Analysis', 'Leadership Development Consultant', 'Mid-Level Leadership Development', 'Neuroleadership', 'Virtual Leadership Coaching', 'N/A'],
  hrSoftware: ['Adaptive Learning', 'Applicant Tracking Software (ATS)', 'Artificial Intelligence', 'Core HR', 'Employee Engagement Software', 'Human Resources Information Systems (HRIS)', 'Human Resource Management Systems (HRMS)', 'Hybrid Workforce Management Software', 'Learning Management System (LMS)', 'Payroll', 'Performance Management Software', 'Recruiting / Candidate Experience Software', 'Talent Management Systems', 'Training Services', 'Virtual & Augmented Reality', 'N/A'],
  learningAndDevelopment: ['Coaching Services', 'Compliance Training', "Corporate Universities / MOOC's", 'Curriculum Design Software / Templates', 'Experience Based Learning', 'Learning Strategy / Operations', 'Organizational Behavior', 'Professional Coaching', 'Reskilling & Upskilling', 'Secondary / Higher Education Partnerships', 'eLearning', 'N/A'],
  organizationalCulture: ['Change Management Consulting', 'Cross-Training', 'Culture Analytics Program', 'Diversity & Inclusion Strategic Planning', 'Employee / Management Shadow Initiatives', 'Emotional Intelligence Training', 'Employee Engagement', 'Employee Engagement Surveys', 'Employee Recognition Management', 'Frontline Employee Engagement', 'Harassment Education & Training', 'Organizational Behavioral Management', 'Rewards & Recognition', 'Unconscious Bias Training', 'Workforce Analytics', 'Workforce Intelligence', 'N/A'],
  talentHcm: ['Coaching & Feedback', 'Employee Insights', 'Employee Retention', 'Integrated Talent Management', 'Mentoring', 'Organizational Planning', 'Performance Tracking & Reviews', 'Succession Planning', 'Total Rewards', 'Workforce Development', 'Workforce Planning / Employee Lifecycle', 'N/A'],
  talentAcquisition: ['Applicant Tracking', 'Background Screening', 'Candidate Experience Software', 'Candidate Marketing', 'Contingent Workforce Recruitment / Outsourcing', 'eRecruiting', 'Global Recruiting', 'Internal Talent Marketplace', 'Onboarding', 'Recruitment & GDPR Compliance', 'Talent Acquisition Dashboard & CRM', 'N/A'],
};

const ATTENDEE_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'Company Name', question_type: 'text', is_required: true, section_label: 'Identity & contact' },
  { prompt: 'First Name', question_type: 'text', is_required: true },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'Work Phone', question_type: 'text' },
  { prompt: 'Cell Phone', question_type: 'text' },
  { prompt: 'How did you hear about this event?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.hearAboutEvent },
  { prompt: 'Dietary Restrictions', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.dietaryRestrictions },
  { prompt: 'Preferred Pronouns', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.pronouns },
  { prompt: 'Address', question_type: 'text', section_label: 'Company information' },
  { prompt: 'City', question_type: 'text', is_required: true },
  { prompt: 'State/Province', question_type: 'text', is_required: true },
  { prompt: 'Zip Code/Postal Code', question_type: 'text' },
  { prompt: 'Country', question_type: 'text' },
  { prompt: 'Assistant First Name', question_type: 'text' },
  { prompt: 'Assistant Last Name', question_type: 'text' },
  { prompt: 'Assistant Email', question_type: 'email' },
  { prompt: 'Assistant Work Phone', question_type: 'text' },
  { prompt: "Company's Annual Revenue", question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.annualRevenue, section_label: 'Eligibility & buying intent' },
  { prompt: 'Select your budget for external solutions for 2026', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.budget2026 },
  { prompt: 'Scope of Responsibility', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.scope },
  { prompt: 'I sit in the C-suite or report directly to the C-suite', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Name of person I report to', question_type: 'text' },
  { prompt: SOLUTION_CATEGORY_INTEREST_PROMPT, question_type: 'multi_select', is_required: true, section_label: 'Solution interest' },
  { prompt: 'Meeting Goals', question_type: 'multi_select', is_required: true, options: MEETING_GOALS_DELEGATE_OPTIONS, section_label: 'Meeting preferences' },
  { prompt: 'What are you hoping to get from this event?', question_type: 'textarea', is_required: true },
  { prompt: 'Headshot/Photo', question_type: 'text', is_required: true, section_label: 'Profile' },
  { prompt: 'I have read and accept the Terms and Conditions and Code of Conduct', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Stage 1 registration' },
];

const VENDOR_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'Company Name', question_type: 'text', is_required: true, section_label: 'Identity & contact' },
  { prompt: 'First Name', question_type: 'text', is_required: true },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'Work Phone', question_type: 'text' },
  { prompt: 'Cell Phone', question_type: 'text' },
  { prompt: 'Address', question_type: 'text', section_label: 'Company information' },
  { prompt: 'City', question_type: 'text', is_required: true },
  { prompt: 'State/Province', question_type: 'text', is_required: true },
  { prompt: 'Zip Code/Postal Code', question_type: 'text' },
  { prompt: 'Country', question_type: 'text' },
  { prompt: 'Company Description', question_type: 'textarea', is_required: true, section_label: 'Marketing profile' },
  { prompt: 'Company Logo Image', question_type: 'text', is_required: true },
  { prompt: 'Company Website', question_type: 'text' },
  { prompt: 'Which seniority levels are you hoping to meet with?', question_type: 'multi_select', is_required: true, options: VENDOR_SENIORITY_OPTIONS, section_label: 'Target audience & ideal customer profile' },
  { prompt: "Ideal customer's revenue range", question_type: 'multi_select', is_required: true, options: VENDOR_REVENUE_OPTIONS },
  { prompt: "Budget range you're hoping your buyer has for 2026", question_type: 'multi_select', is_required: true, options: VENDOR_BUDGET_OPTIONS },
  { prompt: "Functions/scope you're targeting", question_type: 'multi_select', is_required: true, options: VENDOR_SCOPE_OPTIONS },
  { prompt: SOLUTION_CATEGORY_VENDOR_PROMPT, question_type: 'multi_select', is_required: true, section_label: 'Solution interest (vendor)' },
  { prompt: 'Meeting Goals', question_type: 'multi_select', is_required: true, options: MEETING_GOALS_VENDOR_OPTIONS, section_label: 'Meeting preferences & matching' },
  { prompt: 'What are you hoping to accomplish at this event?', question_type: 'textarea', is_required: true },
  { prompt: 'Headshot/Photo', question_type: 'text', is_required: true, section_label: 'Profile & event logistics' },
  { prompt: 'Are you sending representatives to the event onsite?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Logistics' },
  { prompt: 'Will your team take meetings virtually?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
];
const SPEAKER_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'Company Name', question_type: 'text', is_required: true },
  { prompt: 'First Name', question_type: 'text', is_required: true },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'Username (create one to login in future)', question_type: 'text', is_required: true },
  { prompt: 'Work Phone', question_type: 'text', is_required: true },
  { prompt: 'Cell Phone', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'How did you hear about this event?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.hearAboutEvent },
  { prompt: 'Dietary Restrictions', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.dietaryRestrictions },
  { prompt: 'Preferred Pronouns', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.pronouns },
  { prompt: 'Speaker Bio', question_type: 'textarea' },
  { prompt: 'Speaker Headshot', question_type: 'text' },
  { prompt: 'Address', question_type: 'text', section_label: 'Company information' },
  { prompt: 'City', question_type: 'text', is_required: true },
  { prompt: 'State/Province', question_type: 'text', is_required: true },
  { prompt: 'Zip Code/Postal Code', question_type: 'text' },
  { prompt: 'Country', question_type: 'text' },
  { prompt: 'Assistant First Name', question_type: 'text' },
  { prompt: 'Assistant Last Name', question_type: 'text' },
  { prompt: 'Assistant Email', question_type: 'email' },
  { prompt: 'Assistant Work Phone', question_type: 'text' },
  { prompt: "Company's Annual Revenue", question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.annualRevenue, section_label: 'Attendee eligibility questionnaire' },
  { prompt: 'Select your budget for external solutions for 2026', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.budget2026 },
  { prompt: 'Scope of Responsibility', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.scope },
  { prompt: 'I sit in the C-suite or report directly to the C-suite', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Name of person I report to', question_type: 'text', is_required: true },
  { prompt: 'Please list your top 5 Culture, Engagement, and DE&I priorities for 2026', question_type: 'textarea', section_label: 'About your organization' },
  { prompt: 'What challenges are you facing, regarding achieving these objectives?', question_type: 'textarea', is_required: true },
  { prompt: 'Please select the time frame below that best represents the plan to achieve these objectives?', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.timeframe },
  { prompt: 'Total number of employees globally', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.employeeCount },
  { prompt: 'Does your organization provide a tuition assistance benefit?', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: "How does formal education fit into your organization's culture of learning?", question_type: 'textarea', is_required: true },
  { prompt: 'Which technologies or solutions are you currently utilizing for your DE&I and/or Culture & Engagement initiatives?', question_type: 'textarea', is_required: true },
  { prompt: 'Which technologies/solutions are you presently looking to change/upgrade?', question_type: 'textarea', is_required: true },
  { prompt: 'Are you looking to maximize your DE&I strategy with data and analytics?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Are you (or someone who reports to you) responsible for managing your company-wide employee survey program?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Do you or anyone in your department manage compliance requirements for labor law posters, digital postings for remote workers, mandatory employee notifications, and related requirements?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Who handles posting compliance in your organization?', question_type: 'text' },
  { prompt: "Are you responsible for managing your company's rewards and benefits?", question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Are you interested in a solution that makes it easy to create short-form, TikTok-style videos to improve employee experience — from onboarding and training to recognition and employee communication?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Coaching', question_type: 'multi_select', section_label: 'Solution interests', options: CATEGORY_OPTIONS.coaching },
  { prompt: 'Consulting & Services', question_type: 'multi_select', options: CATEGORY_OPTIONS.consulting },
  { prompt: 'Culture, Engagement & Wellness', question_type: 'multi_select', options: CATEGORY_OPTIONS.cultureWellness },
  { prompt: 'Technologies', question_type: 'multi_select', options: CATEGORY_OPTIONS.technologies },
  { prompt: 'Training', question_type: 'multi_select', options: CATEGORY_OPTIONS.training },
  { prompt: 'Workforce & Leadership Development', question_type: 'multi_select', options: CATEGORY_OPTIONS.workforceLeadership },
  { prompt: 'Other Provider Offerings Not Listed', question_type: 'textarea', section_label: 'Solution interests' },
  { prompt: 'I have read and accept the Terms and Conditions and Code of Conduct', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
];
const KBM_ATTENDEE_FORM_NAME = 'KBM Attendee Registration';
const KBM_VENDOR_FORM_NAME = 'KBM Vendor Registration';
const SPEAKER_FORM_NAME = 'Speaker Registration';

function formatDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function titleizeAudience(audience: MatchmakingAudience) {
  if (audience === 'user') return 'Speaker';
  if (audience === 'vendor') return 'Vendor';
  return 'Delegate';
}

function isMatchPoolEligible(audience: MatchmakingAudience) {
  return audience === 'attendee' || audience === 'vendor';
}

function toDisplayFormName(form: EventRegistrationForm) {
  if (form.audience === 'attendee') return 'Delegate Registration';
  if (form.audience === 'vendor') return 'Vendor Registration';
  if (form.audience === 'user') return 'Speaker Registration';
  return form.name;
}

function normalizeSectionLabel(sectionLabel: string | null | undefined) {
  const trimmed = (sectionLabel ?? '').trim();
  return trimmed || 'General';
}

function normalizePrompt(prompt: string) {
  return prompt.trim().toLowerCase();
}

function canonicalSectionLabel(sectionLabel: string | null | undefined) {
  const label = normalizeSectionLabel(sectionLabel);
  if (/^solution provider categories$/i.test(label) || /^solution providers categories$/i.test(label)) {
    return 'Solution providers categories';
  }
  return label;
}

/** Stored section_label for DB: null means uncategorized / General in UI */
function sectionLabelForDatabase(rollingHeading: string | null): string | null {
  if (!rollingHeading?.trim()) return null;
  const canon = canonicalSectionLabel(rollingHeading.trim());
  return canon === 'General' ? null : canon;
}

/** Ordered section headings from template inheritance (for admin picklists) */
function collectInheritedSectionLabels(templateQuestions: TemplateQuestion[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  let rolling: string | null = null;
  templateQuestions.forEach((q) => {
    if (q.section_label?.trim()) rolling = q.section_label.trim();
    if (!rolling?.trim()) return;
    const canon = canonicalSectionLabel(rolling.trim());
    if (canon === 'General' || seen.has(canon)) return;
    seen.add(canon);
    ordered.push(canon);
  });
  return ordered;
}

function buildPromptSectionMap(templateQuestions: TemplateQuestion[]) {
  const map = new Map<string, string>();
  let currentSection = 'General';
  templateQuestions.forEach((q) => {
    if (q.section_label?.trim()) currentSection = q.section_label.trim();
    map.set(normalizePrompt(q.prompt), canonicalSectionLabel(currentSection));
  });
  return map;
}

const ATTENDEE_PROMPT_SECTION_MAP = buildPromptSectionMap(ATTENDEE_TEMPLATE_QUESTIONS);
const VENDOR_PROMPT_SECTION_MAP = buildPromptSectionMap(VENDOR_TEMPLATE_QUESTIONS);
const SPEAKER_PROMPT_SECTION_MAP = buildPromptSectionMap(SPEAKER_TEMPLATE_QUESTIONS);

const ATTENDEE_TEMPLATE_SECTION_PICKLIST = collectInheritedSectionLabels(ATTENDEE_TEMPLATE_QUESTIONS);
const VENDOR_TEMPLATE_SECTION_PICKLIST = collectInheritedSectionLabels(VENDOR_TEMPLATE_QUESTIONS);
const SPEAKER_TEMPLATE_SECTION_PICKLIST = collectInheritedSectionLabels(SPEAKER_TEMPLATE_QUESTIONS);

function sectionMapForAudience(audience: MatchmakingAudience) {
  if (audience === 'vendor') return VENDOR_PROMPT_SECTION_MAP;
  if (audience === 'user') return SPEAKER_PROMPT_SECTION_MAP;
  return ATTENDEE_PROMPT_SECTION_MAP;
}

function questionMatchesSectionHeading(q: EventRegistrationQuestion, uiHeading: string) {
  return canonicalSectionLabel(q.section_label) === canonicalSectionLabel(uiHeading);
}

function isLegacyMeetMaxName(name: string) {
  return /meet\s*max/i.test(name);
}

async function normalizeLegacyFormNames(inputForms: EventRegistrationForm[]) {
  let outputForms = [...inputForms];
  for (const form of inputForms) {
    if (!isLegacyMeetMaxName(form.name)) continue;
    const nextName = `KBM Legacy ${titleizeAudience(form.audience)} Registration (${form.id.slice(0, 6)})`;
    const { data, error } = await supabase
      .from('event_registration_forms')
      .update({ name: nextName })
      .eq('id', form.id)
      .select('*')
      .single();
    if (error) throw error;
    const updated = data as EventRegistrationForm;
    outputForms = outputForms.map((item) => (item.id === updated.id ? updated : item));
  }
  return outputForms;
}

function toPrimaryForms(inputForms: EventRegistrationForm[]) {
  const byAudience = new Map<MatchmakingAudience, EventRegistrationForm[]>();
  inputForms.forEach((form) => {
    const list = byAudience.get(form.audience) ?? [];
    list.push(form);
    byAudience.set(form.audience, list);
  });

  const result: EventRegistrationForm[] = [];
  (['attendee', 'vendor', 'user'] as MatchmakingAudience[]).forEach((audience) => {
    const list = byAudience.get(audience) ?? [];
    if (audience === 'attendee' || audience === 'vendor' || audience === 'user') {
      const canonicalName = audience === 'attendee' ? KBM_ATTENDEE_FORM_NAME : audience === 'vendor' ? KBM_VENDOR_FORM_NAME : SPEAKER_FORM_NAME;
      const canonical = list.find((f) => f.name === canonicalName) ?? list[0];
      if (canonical) result.push(canonical);
      return;
    }
    if (list[0]) result.push(list[0]);
  });
  return result;
}

type MatchmakingTab = 'portal' | 'forms' | 'registrations' | 'matching' | 'schedule';

const MATCHMAKING_TABS: { id: MatchmakingTab; label: string; introTitle: string; intro: string }[] = [
  {
    id: 'portal',
    label: 'Portal setup',
    introTitle: 'Connect portal',
    intro: 'Share registration links, customize the banner, control Stage 2 access, and configure what delegates see after they sign in.',
  },
  {
    id: 'forms',
    label: 'Forms & questions',
    introTitle: 'Registration forms',
    intro: 'Choose delegate, vendor, or speaker forms and edit the questions that appear on connect.kbmcollective.org.',
  },
  {
    id: 'registrations',
    label: 'Registrations',
    introTitle: 'Registration inbox',
    intro: 'Review who has registered, open a submission to see every answer before approving, export data, or jump to matching.',
  },
  {
    id: 'matching',
    label: 'Matching & approve',
    introTitle: 'Review pairings',
    intro:
      'Pick a delegate or vendor, compare their ranked portal meeting requests with intelligent match suggestions, and approve pairings for scheduling.',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    introTitle: '1:1 meeting schedule',
    intro: 'Assign times and locations to approved pairings, then publish meetings to the app.',
  },
];

function parseMatchmakingTab(raw: string | undefined): MatchmakingTab | null {
  if (
    raw === 'portal' ||
    raw === 'forms' ||
    raw === 'registrations' ||
    raw === 'matching' ||
    raw === 'schedule'
  ) {
    return raw;
  }
  return null;
}

function submissionDisplayName(submission: EventRegistrationSubmission): string {
  return [submission.first_name, submission.last_name].filter(Boolean).join(' ') || submission.email || 'Registrant';
}

function TabIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.tabIntro}>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function CopyLinkCard({ label, url, hint }: { label: string; url: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className={styles.linkCard}>
      <div className={styles.linkCardHead}>
        <strong>{label}</strong>
        {hint ? <span className={styles.linkCardHint}>{hint}</span> : null}
      </div>
      <div className={styles.linkCardRow}>
        <code className={styles.linkCardUrl}>{url}</code>
        <button type="button" className={styles.btnSecondary} onClick={() => void onCopy()}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}

type BadgeTone = 'success' | 'warn' | 'muted' | 'danger' | 'info';

function StatusBadge({ label, tone = 'muted' }: { label: string; tone?: BadgeTone }) {
  return <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{label}</span>;
}

function registrationReviewTone(status: string | null | undefined): BadgeTone {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warn';
}

function formStatusTone(status: string): BadgeTone {
  if (status === 'submitted') return 'success';
  if (status === 'draft') return 'muted';
  return 'info';
}

function matchReviewTone(status: string): BadgeTone {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warn';
}

function formatRegistrationAnswerDisplay(ans: EventRegistrationAnswer): string {
  if (Array.isArray(ans.answer_json)) {
    return (ans.answer_json as string[]).join(', ');
  }
  if (ans.answer_json != null && typeof ans.answer_json === 'object') {
    return JSON.stringify(ans.answer_json);
  }
  if (ans.answer_json != null) return String(ans.answer_json);
  if (ans.answer_text != null) return ans.answer_text;
  if (ans.answer_number != null) return String(ans.answer_number);
  if (ans.answer_boolean != null) return ans.answer_boolean ? 'Yes' : 'No';
  return '';
}

function isImageAnswerValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(v) || v.includes('/storage/v1/object/public/');
}

function isFileAnswerValue(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) || v.startsWith('data:');
}

export default function EventMatchmaking() {
  const { eventId, tab: tabParam } = useParams<{ eventId: string; tab?: string }>();
  const navigate = useNavigate();
  const submissionReviewRef = useRef<HTMLDivElement | null>(null);
  const activeTab = parseMatchmakingTab(tabParam) ?? 'portal';
  const [event, setEvent] = useState<Event | null>(null);
  const [forms, setForms] = useState<EventRegistrationForm[]>([]);
  const [questions, setQuestions] = useState<EventRegistrationQuestion[]>([]);
  const [questionOptions, setQuestionOptions] = useState<EventRegistrationQuestionOption[]>([]);
  const [submissions, setSubmissions] = useState<EventRegistrationSubmission[]>([]);
  const [answers, setAnswers] = useState<EventRegistrationAnswer[]>([]);
  const [meetingRequests, setMeetingRequests] = useState<EventMeetingInterestRequest[]>([]);
  const [reviews, setReviews] = useState<EventMatchReview[]>([]);
  const [scheduledMeetings, setScheduledMeetings] = useState<EventMatchScheduledMeeting[]>([]);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [meetingRequestsOpen, setMeetingRequestsOpen] = useState(false);
  const [delegateHotelVisible, setDelegateHotelVisible] = useState(true);
  const [delegateHotelContent, setDelegateHotelContent] = useState('');
  const [registrationNotifyTeamEmails, setRegistrationNotifyTeamEmails] = useState('');
  const [delegateStage2Active, setDelegateStage2Active] = useState(false);
  const [vendorStage2Active, setVendorStage2Active] = useState(false);
  const [stage2HoldingMessage, setStage2HoldingMessage] = useState('');
  const [stage2ExpectedOpenAt, setStage2ExpectedOpenAt] = useState('');
  const [savingPortalSettings, setSavingPortalSettings] = useState(false);
  const [uploadingPortalBanner, setUploadingPortalBanner] = useState(false);
  const portalBannerInputRef = useRef<HTMLInputElement>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [submissionActionId, setSubmissionActionId] = useState('');
  const [publishingMeetingId, setPublishingMeetingId] = useState('');
  const [matchConfig, setMatchConfig] = useState<MatchConfigWeights>(DEFAULT_MATCH_CONFIG);
  const [savingMatchConfig, setSavingMatchConfig] = useState(false);
  const [suggestedMatches, setSuggestedMatches] = useState<RankedMatch[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [newFormName, setNewFormName] = useState('');
  const [newFormAudience, setNewFormAudience] = useState<MatchmakingAudience>('attendee');
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState('');

  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionType, setQuestionType] = useState<MatchmakingQuestionType>('text');
  const [questionRequired, setQuestionRequired] = useState(false);
  const [questionSectionLabel, setQuestionSectionLabel] = useState('');
  /** '' = General; '__custom__' = use questionSectionLabel */
  const [questionSectionPick, setQuestionSectionPick] = useState<string>('');
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [sectionFromLabel, setSectionFromLabel] = useState('');
  const [sectionRenameLabel, setSectionRenameLabel] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  /** Section label where inline “add question” form is open, or null. */
  const [addingQuestionToSection, setAddingQuestionToSection] = useState<string | null>(null);
  /** Section label with inline rename input open, or null. */
  const [renamingSectionLabel, setRenamingSectionLabel] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [sectionFilterLabel, setSectionFilterLabel] = useState<'all' | string>('all');
  const [questionSearchQuery, setQuestionSearchQuery] = useState('');
  const [showHiddenLegacyQuestions, setShowHiddenLegacyQuestions] = useState(false);
  const [scoringAdvancedOpen, setScoringAdvancedOpen] = useState(false);
  const [duplicatingQuestionId, setDuplicatingQuestionId] = useState('');
  const [sectionBusy, setSectionBusy] = useState(false);
  const [repairingSections, setRepairingSections] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [editingQuestionPrompt, setEditingQuestionPrompt] = useState('');
  const [editingQuestionType, setEditingQuestionType] = useState<MatchmakingQuestionType>('text');
  const [editingQuestionRequired, setEditingQuestionRequired] = useState(false);
  const [editingQuestionSectionLabel, setEditingQuestionSectionLabel] = useState('');
  const [editingQuestionUsedInMatching, setEditingQuestionUsedInMatching] = useState(false);
  const [savingQuestionEdit, setSavingQuestionEdit] = useState(false);
  /** Avoid resetting edit fields when `questions` refreshes (e.g. section repair) while the user is typing. */
  const editHydratedForQuestionIdRef = useRef<string | null>(null);
  /** True after the user changes any edit-panel field; cleared on save or when switching questions. */
  const questionEditTouchedRef = useRef(false);
  const questionEditorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [editingOptionId, setEditingOptionId] = useState('');
  const [editingOptionLabel, setEditingOptionLabel] = useState('');
  const [savingOptionEdit, setSavingOptionEdit] = useState(false);
  const [optionError, setOptionError] = useState('');
  const [subFilter, setSubFilter] = useState<'all' | 'submitted' | 'draft'>('all');
  const [audienceFilter, setAudienceFilter] = useState<'all' | MatchmakingAudience>('all');
  const [ensuringDefaults, setEnsuringDefaults] = useState(false);
  const [didInitialDefaultSync, setDidInitialDefaultSync] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [scheduleLocation, setScheduleLocation] = useState('');
  const [deletingSubmissionId, setDeletingSubmissionId] = useState('');

  const visibleForms = useMemo(() => toPrimaryForms(forms), [forms]);
  const activeForm = useMemo(
    () => visibleForms.find((f) => f.id === selectedFormId) ?? visibleForms[0] ?? null,
    [visibleForms, selectedFormId]
  );

  const activeQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.form_id === activeForm?.id)
        .filter((q) => showHiddenLegacyQuestions || !q.is_hidden)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questions, activeForm, showHiddenLegacyQuestions],
  );
  const hiddenLegacyQuestionCount = useMemo(
    () => questions.filter((q) => q.form_id === activeForm?.id && q.is_hidden).length,
    [questions, activeForm],
  );
  const selectedQuestion = useMemo(() => questions.find((q) => q.id === selectedQuestionId) ?? null, [questions, selectedQuestionId]);
  const selectedQuestionOptions = useMemo(
    () =>
      questionOptions
        .filter((opt) => opt.question_id === selectedQuestionId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questionOptions, selectedQuestionId]
  );
  const templateSectionPicklist = useMemo(() => {
    if (!activeForm) return ATTENDEE_TEMPLATE_SECTION_PICKLIST;
    if (activeForm.audience === 'vendor') return VENDOR_TEMPLATE_SECTION_PICKLIST;
    if (activeForm.audience === 'user') return SPEAKER_TEMPLATE_SECTION_PICKLIST;
    return ATTENDEE_TEMPLATE_SECTION_PICKLIST;
  }, [activeForm]);

  const activeFormSectionOrder = useMemo(
    () => (activeForm ? mergeSectionOrder(activeForm, activeQuestions) : []),
    [activeForm, activeQuestions],
  );

  const activeSectionGroups = useMemo(() => {
    const groups = new Map<string, EventRegistrationQuestion[]>();
    activeQuestions.forEach((q) => {
      const key = canonicalSectionLabel(q.section_label);
      const list = groups.get(key) ?? [];
      list.push(q);
      groups.set(key, list);
    });

    if (!activeForm) {
      return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
    }

    const order = activeFormSectionOrder;
    const result: Array<{ label: string; items: EventRegistrationQuestion[] }> = [];
    const seen = new Set<string>();

    for (const label of order) {
      result.push({ label, items: groups.get(label) ?? [] });
      seen.add(label);
    }
    if (groups.has('General') && !seen.has('General')) {
      result.unshift({ label: 'General', items: groups.get('General') ?? [] });
      seen.add('General');
    }
    for (const [label, items] of groups) {
      if (!seen.has(label)) result.push({ label, items });
    }
    return result;
  }, [activeQuestions, activeForm, activeFormSectionOrder]);
  const sectionChoices = useMemo(
    () => Array.from(new Set(activeQuestions.map((q) => canonicalSectionLabel(q.section_label)))),
    [activeQuestions]
  );
  const sectionFilterChoices = useMemo(() => {
    const labels = new Set<string>(activeFormSectionOrder);
    sectionChoices.forEach((s) => labels.add(s));
    return Array.from(labels);
  }, [activeFormSectionOrder, sectionChoices]);

  const addQuestionSectionPickOptions = useMemo(() => {
    const merged = new Set<string>(templateSectionPicklist);
    activeFormSectionOrder.forEach((s) => {
      if (s !== 'General') merged.add(s);
    });
    sectionChoices.forEach((s) => {
      if (s !== 'General') merged.add(s);
    });
    return Array.from(merged).sort((a, b) => {
      const ai = activeFormSectionOrder.indexOf(a);
      const bi = activeFormSectionOrder.indexOf(b);
      const aRank = ai >= 0 ? ai : 999;
      const bRank = bi >= 0 ? bi : 999;
      if (aRank !== bRank) return aRank - bRank;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [templateSectionPicklist, sectionChoices, activeFormSectionOrder]);
  const visibleSectionGroups = useMemo(
    () => (sectionFilterLabel === 'all' ? activeSectionGroups : activeSectionGroups.filter((group) => group.label === sectionFilterLabel)),
    [activeSectionGroups, sectionFilterLabel]
  );
  const questionSearchNorm = questionSearchQuery.trim().toLowerCase();
  const filteredQuestionSectionGroups = useMemo(() => {
    if (!questionSearchNorm) return visibleSectionGroups;
    return visibleSectionGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (q) =>
            q.prompt.toLowerCase().includes(questionSearchNorm) ||
            q.question_type.toLowerCase().includes(questionSearchNorm) ||
            canonicalSectionLabel(q.section_label).toLowerCase().includes(questionSearchNorm)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [visibleSectionGroups, questionSearchNorm]);

  const editFormDirty = useMemo(() => {
    if (!selectedQuestion) return false;
    return (
      editingQuestionPrompt.trim() !== selectedQuestion.prompt.trim() ||
      editingQuestionType !== selectedQuestion.question_type ||
      editingQuestionRequired !== Boolean(selectedQuestion.is_required) ||
      editingQuestionSectionLabel.trim() !== (selectedQuestion.section_label ?? '').trim() ||
      editingQuestionUsedInMatching !== Boolean(selectedQuestion.used_in_matching)
    );
  }, [
    selectedQuestion,
    editingQuestionPrompt,
    editingQuestionType,
    editingQuestionRequired,
    editingQuestionSectionLabel,
    editingQuestionUsedInMatching,
  ]);

  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((row) => {
        if (subFilter !== 'all' && row.status !== subFilter) return false;
        if (audienceFilter !== 'all' && row.attendee_type !== audienceFilter) return false;
        return true;
      }),
    [submissions, subFilter, audienceFilter]
  );
  const matchPoolSubmissions = useMemo(
    () =>
      submissions
        .filter((s) => isMatchPoolEligible(s.attendee_type))
        .sort((a, b) => {
          const aName = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || '';
          const bName = [b.first_name, b.last_name].filter(Boolean).join(' ') || b.email || '';
          return aName.localeCompare(bName);
        }),
    [submissions],
  );
  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === selectedSubmissionId) ?? null,
    [submissions, selectedSubmissionId]
  );
  const selectedSubmissionAnswers = useMemo(
    () => answers.filter((a) => a.submission_id === selectedSubmissionId),
    [answers, selectedSubmissionId]
  );
  const selectedSubmissionRequests = useMemo(
    () =>
      meetingRequests
        .filter((r) => r.submission_id === selectedSubmissionId)
        .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [meetingRequests, selectedSubmissionId]
  );
  const meetingRequestByTargetId = useMemo(() => {
    const map = new Map<string, EventMeetingInterestRequest>();
    for (const req of selectedSubmissionRequests) {
      if (req.target_submission_id) map.set(req.target_submission_id, req);
    }
    return map;
  }, [selectedSubmissionRequests]);
  const selectedSubmissionReviewSections = useMemo(() => {
    if (!selectedSubmission) return [];
    const formQuestions = questions
      .filter((q) => q.form_id === selectedSubmission.form_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    const answerByQuestionId = new Map(selectedSubmissionAnswers.map((a) => [a.question_id, a]));
    const sections = new Map<
      string,
      Array<{
        question: EventRegistrationQuestion;
        displayValue: string;
        isImage: boolean;
        isFile: boolean;
      }>
    >();

    for (const q of formQuestions) {
      const promptNorm = q.prompt.trim().toLowerCase();
      if (REGISTRATION_HEADER_FIELD_PROMPTS.has(promptNorm)) continue;
      const ans = answerByQuestionId.get(q.id) ?? null;
      const displayValue = ans ? formatRegistrationAnswerDisplay(ans) : '';
      const sectionLabel = (q.section_label ?? '').trim() || 'Registration';
      if (!sections.has(sectionLabel)) sections.set(sectionLabel, []);
      sections.get(sectionLabel)!.push({
        question: q,
        displayValue,
        isImage: isImageAnswerValue(displayValue),
        isFile: !isImageAnswerValue(displayValue) && isFileAnswerValue(displayValue),
      });
    }

    return Array.from(sections.entries()).map(([label, items]) => ({ label, items }));
  }, [selectedSubmission, questions, selectedSubmissionAnswers]);
  const scrollToSubmissionReview = useCallback(() => {
    window.setTimeout(() => {
      submissionReviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }, []);

  const selectSubmissionForReview = useCallback(
    (id: string) => {
      setSelectedSubmissionId(id);
      if (activeTab === 'registrations') {
        scrollToSubmissionReview();
      }
    },
    [scrollToSubmissionReview, activeTab],
  );

  const requestedNotInTopScores = useMemo(() => {
    if (!selectedSubmission) return [];
    const topIds = new Set(suggestedMatches.map((m) => m.candidate.id));
    return selectedSubmissionRequests.filter(
      (req) => req.target_submission_id && !topIds.has(req.target_submission_id),
    );
  }, [selectedSubmission, selectedSubmissionRequests, suggestedMatches]);

  const meetingRequestByPair = useMemo(() => {
    const map = new Map<string, EventMeetingInterestRequest>();
    for (const req of meetingRequests) {
      if (req.target_submission_id) {
        map.set(`${req.submission_id}:${req.target_submission_id}`, req);
      }
    }
    return map;
  }, [meetingRequests]);

  const approvedReviews = useMemo(() => reviews.filter((r) => r.status === 'approved'), [reviews]);

  const scheduledReviewIds = useMemo(
    () => new Set(scheduledMeetings.map((m) => m.review_id).filter(Boolean) as string[]),
    [scheduledMeetings],
  );

  useEffect(() => {
    if (!eventId || !selectedSubmission) {
      setSuggestedMatches([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSuggestions(true);
      try {
        const { data, error: rpcErr } = await supabase.rpc('rank_submission_matches', {
          p_event_id: eventId,
          p_submission_id: selectedSubmission.id,
          p_limit: 12,
        });
        if (rpcErr) throw rpcErr;
        if (cancelled) return;
        const rows = (data ?? []) as Array<{ candidate_id: string; score: number; category_overlap: number }>;
        const submissionById = new Map(submissions.map((s) => [s.id, s]));
        const requestRankByTargetId = new Map(
          selectedSubmissionRequests
            .filter((r) => r.target_submission_id)
            .map((r, index) => [r.target_submission_id as string, index + 1]),
        );
        setSuggestedMatches(
          rows
            .filter((row) => row.score > 0)
            .map((row) => {
              const candidate = submissionById.get(row.candidate_id);
              if (!candidate) return null;
              const existingReview = reviews.find(
                (rev) =>
                  rev.from_submission_id === selectedSubmission.id && rev.to_submission_id === row.candidate_id
              );
              const meetingRequest = meetingRequestByTargetId.get(row.candidate_id) ?? null;
              return {
                candidate,
                score: row.score,
                overlap: row.category_overlap,
                review: existingReview ?? null,
                meetingRequest,
                requestRank: meetingRequest?.target_submission_id
                  ? (requestRankByTargetId.get(meetingRequest.target_submission_id) ?? null)
                  : null,
              };
            })
            .filter((item): item is RankedMatch => item != null)
        );
      } catch {
        if (!cancelled) setSuggestedMatches([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, selectedSubmission, submissions, reviews, selectedSubmissionRequests, meetingRequestByTargetId]);

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, portal_banner_url, badge_banner_url, banner_url, logo_url')
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      setEvent((ev as Event) ?? null);

      const [{ data: formRows, error: formErr }, { data: submissionRows, error: submissionErr }, { data: settingsRow, error: settingsErr }, { data: requestRows, error: requestErr }, { data: reviewRows, error: reviewErr }, { data: schedRows, error: schedErr }] = await Promise.all([
        supabase
          .from('event_registration_forms')
          .select('*')
          .eq('event_id', eventId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('event_registration_submissions')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('event_matchmaking_settings')
          .select('registration_open, meeting_requests_open, delegate_portal_hotel_visible, delegate_hotel_content, registration_notify_team_emails, delegate_stage2_active, vendor_stage2_active, stage2_holding_message, stage2_expected_open_at')
          .eq('event_id', eventId)
          .maybeSingle(),
        supabase
          .from('event_meeting_interest_requests')
          .select('*')
          .eq('event_id', eventId)
          .order('priority', { ascending: true }),
        supabase
          .from('event_match_reviews')
          .select('*')
          .eq('event_id', eventId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('event_match_scheduled_meetings')
          .select('*')
          .eq('event_id', eventId)
          .order('start_time', { ascending: true }),
      ]);

      if (formErr) throw formErr;
      if (submissionErr) throw submissionErr;
      if (settingsErr) throw settingsErr;
      if (requestErr) throw requestErr;
      if (reviewErr) throw reviewErr;
      if (schedErr) throw schedErr;
      setRegistrationOpen(Boolean((settingsRow as { registration_open?: boolean } | null)?.registration_open));
      const settings = settingsRow as {
        meeting_requests_open?: boolean;
        delegate_portal_hotel_visible?: boolean;
        delegate_hotel_content?: string | null;
        registration_notify_team_emails?: string | null;
        delegate_stage2_active?: boolean;
        vendor_stage2_active?: boolean;
        stage2_holding_message?: string | null;
        stage2_expected_open_at?: string | null;
      } | null;
      setMeetingRequestsOpen(Boolean(settings?.meeting_requests_open));
      setDelegateHotelVisible(settings?.delegate_portal_hotel_visible !== false);
      setDelegateHotelContent(settings?.delegate_hotel_content ?? '');
      setRegistrationNotifyTeamEmails(settings?.registration_notify_team_emails ?? '');
      setDelegateStage2Active(Boolean(settings?.delegate_stage2_active));
      setVendorStage2Active(Boolean(settings?.vendor_stage2_active));
      setStage2HoldingMessage(settings?.stage2_holding_message ?? '');
      setStage2ExpectedOpenAt(formatDatetimeLocalValue(settings?.stage2_expected_open_at));

      const { data: matchConfigRow, error: matchConfigErr } = await supabase
        .from('event_match_config')
        .select('weight_category, weight_goals, weight_seniority, weight_revenue, weight_budget, weight_scope, weight_semantic')
        .eq('event_id', eventId)
        .maybeSingle();
      if (matchConfigErr) throw matchConfigErr;
      if (matchConfigRow) {
        setMatchConfig({
          weight_category: matchConfigRow.weight_category ?? DEFAULT_MATCH_CONFIG.weight_category,
          weight_goals: matchConfigRow.weight_goals ?? DEFAULT_MATCH_CONFIG.weight_goals,
          weight_seniority: matchConfigRow.weight_seniority ?? DEFAULT_MATCH_CONFIG.weight_seniority,
          weight_revenue: matchConfigRow.weight_revenue ?? DEFAULT_MATCH_CONFIG.weight_revenue,
          weight_budget: matchConfigRow.weight_budget ?? DEFAULT_MATCH_CONFIG.weight_budget,
          weight_scope: matchConfigRow.weight_scope ?? DEFAULT_MATCH_CONFIG.weight_scope,
          weight_semantic: matchConfigRow.weight_semantic ?? DEFAULT_MATCH_CONFIG.weight_semantic,
        });
      } else {
        setMatchConfig(DEFAULT_MATCH_CONFIG);
      }

      const nextFormsRaw = (formRows as EventRegistrationForm[]) ?? [];
      const nextForms = await normalizeLegacyFormNames(nextFormsRaw);
      setForms(nextForms);
      const primaryForms = toPrimaryForms(nextForms);
      const firstFormId = primaryForms[0]?.id ?? '';
      if (!selectedFormId && firstFormId) setSelectedFormId(firstFormId);
      if (selectedFormId && !primaryForms.some((f) => f.id === selectedFormId)) setSelectedFormId(firstFormId);

      const nextSubmissions = (submissionRows as EventRegistrationSubmission[]) ?? [];
      setSubmissions(nextSubmissions);
      if (nextSubmissions.length > 0) {
        const { data: answerRows, error: answerErr } = await supabase
          .from('event_registration_answers')
          .select('*')
          .in(
            'submission_id',
            nextSubmissions.map((s) => s.id)
          )
          .limit(5000);
        if (answerErr) throw answerErr;
        setAnswers((answerRows as EventRegistrationAnswer[]) ?? []);
      } else {
        setAnswers([]);
      }
      setMeetingRequests((requestRows as EventMeetingInterestRequest[]) ?? []);
      setReviews((reviewRows as EventMatchReview[]) ?? []);
      setScheduledMeetings((schedRows as EventMatchScheduledMeeting[]) ?? []);

      if (nextForms.length > 0) {
        const { data: questionRows, error: questionErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .in(
            'form_id',
            nextForms.map((f) => f.id)
          )
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (questionErr) throw questionErr;
        const qList = (questionRows as EventRegistrationQuestion[]) ?? [];
        setQuestions(qList);
        const firstQuestionId = qList[0]?.id ?? '';
        if (!selectedQuestionId && firstQuestionId) setSelectedQuestionId(firstQuestionId);
        if (qList.length > 0) {
          const { data: optionRows, error: optionErr } = await supabase
            .from('event_registration_question_options')
            .select('*')
            .in(
              'question_id',
              qList.map((q) => q.id)
            )
            .order('sort_order', { ascending: true });
          if (optionErr) throw optionErr;
          setQuestionOptions((optionRows as EventRegistrationQuestionOption[]) ?? []);
        } else {
          setQuestionOptions([]);
        }
      } else {
        setQuestions([]);
        setQuestionOptions([]);
      }
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Failed to load matchmaking data');
      setForms([]);
      setQuestions([]);
      setQuestionOptions([]);
      setSubmissions([]);
      setAnswers([]);
      setMeetingRequests([]);
      setReviews([]);
      setScheduledMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedFormId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    setAddingQuestionToSection(null);
    setRenamingSectionLabel(null);
    setCollapsedSections({});
    setQuestionSearchQuery('');
    setSectionFilterLabel('all');
  }, [selectedFormId]);

  const addForm = async () => {
    if (!eventId) return;
    const name = newFormName.trim();
    if (!name) {
      setFormError('Form name is required.');
      return;
    }
    setSavingForm(true);
    setFormError('');
    try {
      const nextSort = forms.length > 0 ? Math.max(...forms.map((f) => f.sort_order)) + 1 : 0;
      const { data, error: insErr } = await supabase
        .from('event_registration_forms')
        .insert({
          event_id: eventId,
          name,
          audience: newFormAudience,
          is_active: true,
          sort_order: nextSort,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      const created = data as EventRegistrationForm;
      setForms((prev) => [...prev, created]);
      setSelectedFormId(created.id);
      setNewFormName('');
      setNewFormAudience('attendee');
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Could not create form');
    } finally {
      setSavingForm(false);
    }
  };

  const addQuestion = async (forcedSectionLabel?: string) => {
    if (!selectedFormId) return;
    const prompt = questionPrompt.trim();
    if (!prompt) {
      setQuestionError('Question prompt is required.');
      return;
    }
    const useForcedSection = forcedSectionLabel !== undefined;
    if (!useForcedSection && questionSectionPick === '__custom__' && !questionSectionLabel.trim()) {
      setQuestionError('Choose a section from the list or enter a custom section name.');
      return;
    }
    setSavingQuestion(true);
    setQuestionError('');
    try {
      const formQuestions = questions.filter((q) => q.form_id === selectedFormId);
      const nextSort = formQuestions.length > 0 ? Math.max(...formQuestions.map((q) => q.sort_order)) + 1 : 0;
      const resolvedSectionLabel = useForcedSection
        ? forcedSectionLabel === 'General'
          ? null
          : sectionLabelForDatabase(forcedSectionLabel)
        : questionSectionPick === '__custom__'
          ? sectionLabelForDatabase(questionSectionLabel)
          : questionSectionPick === ''
            ? null
            : sectionLabelForDatabase(questionSectionPick);
      const { data, error: insErr } = await supabase
        .from('event_registration_questions')
        .insert({
          form_id: selectedFormId,
          prompt,
          question_type: questionType,
          is_required: questionRequired,
          section_label: resolvedSectionLabel,
          is_base_question: false,
          sort_order: nextSort,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      setQuestions((prev) => [...prev, data as EventRegistrationQuestion]);
      setSelectedQuestionId((data as EventRegistrationQuestion).id);
      const added = data as EventRegistrationQuestion;
      const addedSection = canonicalSectionLabel(added.section_label);
      if (activeForm && addedSection !== 'General') {
        const nextOrder = addSectionToOrder(activeFormSectionOrder, addedSection);
        if (nextOrder.length !== activeFormSectionOrder.length) {
          await saveFormSectionOrder(nextOrder, { silent: true });
        }
      }
      setQuestionPrompt('');
      setQuestionType('text');
      setQuestionRequired(false);
      setQuestionSectionPick('');
      setQuestionSectionLabel('');
      if (useForcedSection) setAddingQuestionToSection(null);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not add question');
    } finally {
      setSavingQuestion(false);
    }
  };

  const openAddQuestionToSection = (sectionLabel: string) => {
    setAddingQuestionToSection(sectionLabel);
    setRenamingSectionLabel(null);
    setQuestionPrompt('');
    setQuestionType('text');
    setQuestionRequired(false);
    setQuestionError('');
  };

  const cancelAddQuestionToSection = () => {
    setAddingQuestionToSection(null);
    setQuestionPrompt('');
    setQuestionType('text');
    setQuestionRequired(false);
  };

  const beginRenameSection = (sectionLabel: string) => {
    setRenamingSectionLabel(sectionLabel);
    setSectionFromLabel(sectionLabel);
    setSectionRenameLabel(sectionLabel);
    setAddingQuestionToSection(null);
    setQuestionError('');
  };

  const cancelRenameSection = () => {
    setRenamingSectionLabel(null);
    setSectionRenameLabel('');
  };

  const toggleSectionCollapsed = (sectionLabel: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionLabel]: !prev[sectionLabel] }));
  };

  const saveFormSectionOrder = async (order: string[], options?: { silent?: boolean }) => {
    if (!activeForm) return;
    setSectionBusy(true);
    if (!options?.silent) setQuestionError('');
    try {
      const { data, error: updErr } = await supabase
        .from('event_registration_forms')
        .update({ section_order: order })
        .eq('id', activeForm.id)
        .select('*')
        .single();
      if (updErr) throw updErr;
      const updated = data as EventRegistrationForm;
      setForms((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch (e) {
      if (!options?.silent) setQuestionError(postgrestErrorMessage(e) || 'Could not save section order');
    } finally {
      setSectionBusy(false);
    }
  };

  const addEmptySection = async () => {
    if (!activeForm) return;
    const name = newSectionName.trim();
    if (!name) {
      setQuestionError('Enter a section name.');
      return;
    }
    if (name === 'General') {
      setQuestionError('Choose a name other than General.');
      return;
    }
    const nextOrder = addSectionToOrder(activeFormSectionOrder, name);
    if (nextOrder.length === activeFormSectionOrder.length) {
      setQuestionError('That section already exists.');
      return;
    }
    setQuestionError('');
    await saveFormSectionOrder(nextOrder);
    setNewSectionName('');
    setSectionFromLabel(name);
    setQuestionSectionPick(name);
  };

  const moveSection = async (sectionLabel: string, dir: -1 | 1) => {
    if (!activeForm || sectionLabel === 'General') return;
    const nextOrder = moveSectionInOrder(activeFormSectionOrder, sectionLabel, dir);
    if (nextOrder === activeFormSectionOrder) return;
    await saveFormSectionOrder(nextOrder);
  };

  const setSectionHidden = async (sectionLabel: string, nextHidden: boolean) => {
    if (!activeForm) return;
    const ids = activeQuestions.filter((q) => questionMatchesSectionHeading(q, sectionLabel)).map((q) => q.id);
    if (ids.length === 0) return;
    setSectionBusy(true);
    setQuestionError('');
    try {
      const { error: updErr } = await supabase.from('event_registration_questions').update({ is_hidden: nextHidden }).in('id', ids);
      if (updErr) throw updErr;
      setQuestions((prev) => prev.map((q) => (ids.includes(q.id) ? { ...q, is_hidden: nextHidden } : q)));
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not update section visibility');
    } finally {
      setSectionBusy(false);
    }
  };

  const renameSection = async (fromLabelOverride?: string, toLabelOverride?: string) => {
    if (!activeForm) return;
    const fromLabel = (fromLabelOverride ?? sectionFromLabel).trim();
    const toLabel = (toLabelOverride ?? sectionRenameLabel).trim();
    if (!fromLabel || fromLabel === 'General') {
      setQuestionError('Select a named section to rename.');
      return;
    }
    if (!toLabel) {
      setQuestionError('New section name is required.');
      return;
    }
    setSectionBusy(true);
    setQuestionError('');
    try {
      const ids = activeQuestions.filter((q) => questionMatchesSectionHeading(q, fromLabel)).map((q) => q.id);
      if (ids.length === 0) return;
      const { error: updErr } = await supabase.from('event_registration_questions').update({ section_label: toLabel }).in('id', ids);
      if (updErr) throw updErr;
      setQuestions((prev) => prev.map((q) => (ids.includes(q.id) ? { ...q, section_label: toLabel } : q)));
      const nextOrder = renameSectionInOrder(activeFormSectionOrder, fromLabel, toLabel);
      await saveFormSectionOrder(nextOrder, { silent: true });
      setSectionFromLabel(toLabel);
      setSectionRenameLabel('');
      setRenamingSectionLabel(null);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not rename section');
    } finally {
      setSectionBusy(false);
    }
  };

  const deleteSection = async (sectionLabel: string) => {
    if (!activeForm) return;
    if (sectionLabel === 'General') {
      setQuestionError('General section cannot be deleted.');
      return;
    }
    const inSection = activeQuestions.filter((q) => questionMatchesSectionHeading(q, sectionLabel));
    if (inSection.length === 0) {
      if (!window.confirm(`Remove empty section "${sectionLabel}"?`)) return;
      setSectionBusy(true);
      setQuestionError('');
      try {
        await saveFormSectionOrder(removeSectionFromOrder(activeFormSectionOrder, sectionLabel), { silent: true });
      } catch (e) {
        setQuestionError(postgrestErrorMessage(e) || 'Could not delete section');
      } finally {
        setSectionBusy(false);
      }
      return;
    }
    if (!window.confirm(`Delete section "${sectionLabel}"? Custom questions will be deleted and base questions hidden.`)) return;
    setSectionBusy(true);
    setQuestionError('');
    try {
      const deletableIds = inSection.filter((q) => !q.is_base_question).map((q) => q.id);
      const hideIds = inSection.filter((q) => q.is_base_question).map((q) => q.id);
      if (deletableIds.length > 0) {
        const { error: delErr } = await supabase.from('event_registration_questions').delete().in('id', deletableIds);
        if (delErr) throw delErr;
      }
      if (hideIds.length > 0) {
        const { error: hideErr } = await supabase.from('event_registration_questions').update({ is_hidden: true }).in('id', hideIds);
        if (hideErr) throw hideErr;
      }
      setQuestions((prev) =>
        prev
          .filter((q) => !deletableIds.includes(q.id))
          .map((q) => (hideIds.includes(q.id) ? { ...q, is_hidden: true } : q))
      );
      if (deletableIds.includes(selectedQuestionId)) setSelectedQuestionId('');
      if (sectionFilterLabel !== 'all' && canonicalSectionLabel(sectionFilterLabel) === canonicalSectionLabel(sectionLabel)) {
        setSectionFilterLabel('all');
      }
      const nextOrder = removeSectionFromOrder(activeFormSectionOrder, sectionLabel);
      await saveFormSectionOrder(nextOrder, { silent: true });
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not delete section');
    } finally {
      setSectionBusy(false);
    }
  };

  const toggleQuestionHidden = async (questionId: string, nextHidden: boolean) => {
    try {
      const { error: updErr } = await supabase
        .from('event_registration_questions')
        .update({ is_hidden: nextHidden })
        .eq('id', questionId);
      if (updErr) throw updErr;
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, is_hidden: nextHidden } : q)));
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not update question visibility');
    }
  };

  const deleteQuestion = async (questionId: string) => {
    const q = questions.find((item) => item.id === questionId);
    if (!q) return;
    if (q.is_base_question) {
      setQuestionError('Base KBM questions cannot be deleted. Hide them instead.');
      return;
    }
    if (!window.confirm('Delete this custom question?')) return;
    try {
      const { error: delErr } = await supabase.from('event_registration_questions').delete().eq('id', questionId);
      if (delErr) throw delErr;
      setQuestions((prev) => prev.filter((item) => item.id !== questionId));
      if (selectedQuestionId === questionId) setSelectedQuestionId('');
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not delete question');
    }
  };

  const duplicateQuestion = async (sourceId: string) => {
    const src = questions.find((item) => item.id === sourceId);
    if (!src) return;
    setDuplicatingQuestionId(sourceId);
    setQuestionError('');
    try {
      const formQs = questions.filter((q) => q.form_id === src.form_id);
      const nextSort = formQs.length > 0 ? Math.max(...formQs.map((q) => q.sort_order)) + 1 : 0;
      const { data: row, error: insErr } = await supabase
        .from('event_registration_questions')
        .insert({
          form_id: src.form_id,
          prompt: `${src.prompt.trim()} (copy)`,
          question_type: src.question_type,
          is_required: src.is_required,
          section_label: src.section_label,
          is_base_question: false,
          sort_order: nextSort,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      const created = row as EventRegistrationQuestion;

      const srcOpts = questionOptions.filter((o) => o.question_id === sourceId).sort((a, b) => a.sort_order - b.sort_order);
      if (srcOpts.length > 0) {
        const payload = srcOpts.map((o, idx) => ({
          question_id: created.id,
          label: o.label,
          value: o.value,
          sort_order: idx,
        }));
        const { data: newOpts, error: optErr } = await supabase.from('event_registration_question_options').insert(payload).select('*');
        if (optErr) throw optErr;
        const inserted = (newOpts as EventRegistrationQuestionOption[]) ?? [];
        setQuestionOptions((prev) => [...prev, ...inserted]);
      }

      setQuestions((prev) => [...prev, created]);
      setSelectedQuestionId(created.id);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not duplicate question');
    } finally {
      setDuplicatingQuestionId('');
    }
  };

  const saveSettings = async (nextOpen: boolean) => {
    if (!eventId) return;
    setSavingSettings(true);
    setError('');
    try {
      const { error: upsertErr } = await supabase.from('event_matchmaking_settings').upsert({
        event_id: eventId,
        registration_open: nextOpen,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;
      setRegistrationOpen(nextOpen);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not save registration settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const savePortalSettings = async () => {
    if (!eventId) return;
    setSavingPortalSettings(true);
    setError('');
    try {
      const { error: upsertErr } = await supabase.from('event_matchmaking_settings').upsert({
        event_id: eventId,
        registration_open: registrationOpen,
        meeting_requests_open: meetingRequestsOpen,
        delegate_portal_hotel_visible: delegateHotelVisible,
        delegate_hotel_content: delegateHotelContent.trim() || null,
        registration_notify_team_emails: registrationNotifyTeamEmails.trim() || null,
        delegate_stage2_active: delegateStage2Active,
        vendor_stage2_active: vendorStage2Active,
        stage2_holding_message: stage2HoldingMessage.trim() || null,
        stage2_expected_open_at: stage2ExpectedOpenAt.trim()
          ? new Date(stage2ExpectedOpenAt).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not save delegate portal settings');
    } finally {
      setSavingPortalSettings(false);
    }
  };

  const persistPortalBanner = async (portal_banner_url: string | null) => {
    if (!eventId) return;
    const { error: err } = await supabase
      .from('events')
      .update({ portal_banner_url, updated_at: new Date().toISOString() })
      .eq('id', eventId);
    if (err) throw err;
  };

  const onPortalBannerFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !eventId) return;
    setError('');
    setUploadingPortalBanner(true);
    try {
      const url = await uploadEventImage(file, eventId, 'portal-banner');
      await persistPortalBanner(url);
      setEvent((prev) => (prev ? { ...prev, portal_banner_url: url } : prev));
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setUploadingPortalBanner(false);
    }
  };

  const onClearPortalBanner = async () => {
    if (!eventId) return;
    setError('');
    setUploadingPortalBanner(true);
    try {
      await persistPortalBanner(null);
      setEvent((prev) => (prev ? { ...prev, portal_banner_url: null } : prev));
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setUploadingPortalBanner(false);
    }
  };

  const portalBannerPreviewSrc =
    (event?.portal_banner_url ?? '').trim() ||
    (event?.badge_banner_url ?? '').trim() ||
    null;

  const saveMatchConfig = async () => {
    if (!eventId) return;
    setSavingMatchConfig(true);
    setError('');
    try {
      const { error: upsertErr } = await supabase.from('event_match_config').upsert({
        event_id: eventId,
        ...matchConfig,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not save match scoring weights');
    } finally {
      setSavingMatchConfig(false);
    }
  };

  const updateRegistrationStatus = async (submission: EventRegistrationSubmission, status: 'approved' | 'rejected') => {
    if (status === 'rejected' && !window.confirm('Reject this registrant? They will be blocked from the portal.')) return;
    setSubmissionActionId(submission.id);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('event_registration_submissions')
        .update({
          registration_status: status,
          rejected_at: status === 'rejected' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (updErr) throw updErr;
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submission.id
            ? { ...s, registration_status: status, rejected_at: status === 'rejected' ? new Date().toISOString() : null }
            : s
        )
      );
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update registration status');
    } finally {
      setSubmissionActionId('');
    }
  };

  const updateMatchingOptIn = async (submission: EventRegistrationSubmission, optIn: boolean) => {
    if (!isMatchPoolEligible(submission.attendee_type)) return;
    const action = optIn ? 'opt this registrant into' : 'opt this registrant out of';
    if (!window.confirm(`${optIn ? 'Opt in' : 'Opt out'} ${[submission.first_name, submission.last_name].filter(Boolean).join(' ') || 'this registrant'} for 1:1 matching?`)) return;
    setSubmissionActionId(submission.id);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('event_registration_submissions')
        .update({
          matching_opt_in: optIn,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (updErr) throw updErr;
      setSubmissions((prev) =>
        prev.map((s) => (s.id === submission.id ? { ...s, matching_opt_in: optIn } : s)),
      );
    } catch (e) {
      setError(postgrestErrorMessage(e) || `Could not ${action} matching`);
    } finally {
      setSubmissionActionId('');
    }
  };

  const resendRegistrationEmail = async (submission: EventRegistrationSubmission) => {
    if (!eventId || !submission.email) return;
    setSubmissionActionId(submission.id);
    setError('');
    try {
      await sendRegistrationSetupEmail({
        event_id: eventId,
        email: submission.email,
        full_name: [submission.first_name, submission.last_name].filter(Boolean).join(' '),
        attendee_type: submission.attendee_type === 'vendor' ? 'vendor' : 'attendee',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend registration email');
    } finally {
      setSubmissionActionId('');
    }
  };

  const generateMatchSuggestions = async () => {
    if (!eventId) return;
    setGeneratingSuggestions(true);
    setError('');
    try {
      const approved = submissions.filter((s) => s.registration_status === 'approved' && s.status === 'submitted');
      for (const sub of approved) {
        const { error: syncErr } = await supabase.rpc('sync_submission_solution_categories', {
          p_submission_id: sub.id,
        });
        if (syncErr) throw syncErr;
      }

      const { error: rpcErr } = await supabase.rpc('generate_event_match_suggestions', {
        p_event_id: eventId,
        p_limit: 200,
      });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not generate match suggestions');
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const publishMeetingToApp = async (meetingId: string) => {
    if (!window.confirm('Publish this meeting to the mobile app? This creates a booking in the existing B2B system.')) return;
    setPublishingMeetingId(meetingId);
    setError('');
    try {
      const { error: rpcErr } = await supabase.rpc('publish_matchmaking_meeting_to_app', { p_meeting_id: meetingId });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not publish meeting to app');
    } finally {
      setPublishingMeetingId('');
    }
  };

  const moveQuestion = async (questionId: string, dir: -1 | 1) => {
    const list = activeQuestions;
    const idx = list.findIndex((q) => q.id === questionId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    if (!a || !b) return;
    try {
      const { error: errA } = await supabase.from('event_registration_questions').update({ sort_order: b.sort_order }).eq('id', a.id);
      if (errA) throw errA;
      const { error: errB } = await supabase.from('event_registration_questions').update({ sort_order: a.sort_order }).eq('id', b.id);
      if (errB) throw errB;
      await load();
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not reorder question');
    }
  };

  const addOptionToSelected = async () => {
    if (!selectedQuestionId) return;
    const label = newOptionLabel.trim();
    if (!label) {
      setOptionError('Option label is required.');
      return;
    }
    setOptionError('');
    try {
      const list = questionOptions.filter((o) => o.question_id === selectedQuestionId);
      const sortOrder = list.length > 0 ? Math.max(...list.map((o) => o.sort_order)) + 1 : 0;
      const { data, error: insErr } = await supabase
        .from('event_registration_question_options')
        .insert({ question_id: selectedQuestionId, label, value: label, sort_order: sortOrder })
        .select('*')
        .single();
      if (insErr) throw insErr;
      setQuestionOptions((prev) => [...prev, data as EventRegistrationQuestionOption]);
      setNewOptionLabel('');
    } catch (e) {
      setOptionError(postgrestErrorMessage(e) || 'Could not add option');
    }
  };

  const beginEditOption = (option: EventRegistrationQuestionOption) => {
    setEditingOptionId(option.id);
    setEditingOptionLabel(option.label);
    setOptionError('');
  };

  const saveOptionEdit = async () => {
    if (!editingOptionId) return;
    const label = editingOptionLabel.trim();
    if (!label) {
      setOptionError('Option label is required.');
      return;
    }
    setSavingOptionEdit(true);
    setOptionError('');
    try {
      const { error: updErr } = await supabase
        .from('event_registration_question_options')
        .update({ label, value: label })
        .eq('id', editingOptionId);
      if (updErr) throw updErr;
      setQuestionOptions((prev) => prev.map((o) => (o.id === editingOptionId ? { ...o, label, value: label } : o)));
      setEditingOptionId('');
      setEditingOptionLabel('');
    } catch (e) {
      setOptionError(postgrestErrorMessage(e) || 'Could not save option');
    } finally {
      setSavingOptionEdit(false);
    }
  };

  const deleteOption = async (optionId: string) => {
    if (!window.confirm('Delete this option?')) return;
    setOptionError('');
    try {
      const { error: delErr } = await supabase.from('event_registration_question_options').delete().eq('id', optionId);
      if (delErr) throw delErr;
      setQuestionOptions((prev) => prev.filter((o) => o.id !== optionId));
      if (editingOptionId === optionId) {
        setEditingOptionId('');
        setEditingOptionLabel('');
      }
    } catch (e) {
      setOptionError(postgrestErrorMessage(e) || 'Could not delete option');
    }
  };

  const moveOption = async (optionId: string, dir: -1 | 1) => {
    const list = selectedQuestionOptions;
    const idx = list.findIndex((o) => o.id === optionId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    if (!a || !b) return;
    setOptionError('');
    try {
      const { error: errA } = await supabase.from('event_registration_question_options').update({ sort_order: b.sort_order }).eq('id', a.id);
      if (errA) throw errA;
      const { error: errB } = await supabase.from('event_registration_question_options').update({ sort_order: a.sort_order }).eq('id', b.id);
      if (errB) throw errB;
      setQuestionOptions((prev) =>
        prev.map((o) => {
          if (o.id === a.id) return { ...o, sort_order: b.sort_order };
          if (o.id === b.id) return { ...o, sort_order: a.sort_order };
          return o;
        })
      );
    } catch (e) {
      setOptionError(postgrestErrorMessage(e) || 'Could not reorder option');
    }
  };

  const saveQuestionEdits = async () => {
    if (!selectedQuestion) return;
    const prompt = editingQuestionPrompt.trim();
    if (!prompt) {
      setQuestionError('Question prompt is required.');
      return;
    }
    setSavingQuestionEdit(true);
    setQuestionError('');
    try {
      const canUseInMatching = !['text', 'textarea', 'email'].includes(editingQuestionType);
      const patch = {
        prompt,
        question_type: editingQuestionType,
        is_required: editingQuestionRequired,
        section_label: sectionLabelForDatabase(editingQuestionSectionLabel.trim()),
        used_in_matching: canUseInMatching ? editingQuestionUsedInMatching : false,
      };
      const { data: updatedRow, error: updErr } = await supabase
        .from('event_registration_questions')
        .update(patch)
        .eq('id', selectedQuestion.id)
        .select('*')
        .single();
      if (updErr) throw updErr;
      const merged = updatedRow as EventRegistrationQuestion;
      questionEditTouchedRef.current = false;
      setQuestions((prev) => prev.map((q) => (q.id === selectedQuestion.id ? { ...q, ...merged } : q)));
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not save question edits');
    } finally {
      setSavingQuestionEdit(false);
    }
  };

  const exportSubmissionsCsv = () => {
    const rows = filteredSubmissions.map((row) => [
      row.first_name ?? '',
      row.last_name ?? '',
      row.email ?? '',
      row.company_name ?? '',
      row.job_title ?? '',
      row.attendee_type,
      row.status,
      row.submitted_at ?? '',
      row.created_at,
    ]);
    const header = ['first_name', 'last_name', 'email', 'company_name', 'job_title', 'audience', 'status', 'submitted_at', 'created_at'];
    const csv = [header, ...rows]
      .map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-${eventId}-registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSubmission = async (submission: EventRegistrationSubmission) => {
    const name =
      [submission.first_name, submission.last_name].filter(Boolean).join(' ') || submission.email || 'this registrant';
    const confirmed = window.confirm(
      `Delete registration for "${name}"?\n\nThis removes their answers, meeting requests, match reviews, and scheduled meetings. This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingSubmissionId(submission.id);
    setError('');
    try {
      const { error: delErr } = await supabase.from('event_registration_submissions').delete().eq('id', submission.id);
      if (delErr) throw delErr;
      const id = submission.id;
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
      setAnswers((prev) => prev.filter((a) => a.submission_id !== id));
      setMeetingRequests((prev) => prev.filter((r) => r.submission_id !== id));
      setReviews((prev) => prev.filter((r) => r.from_submission_id !== id && r.to_submission_id !== id));
      setScheduledMeetings((prev) => prev.filter((m) => m.submission_a_id !== id && m.submission_b_id !== id));
      if (selectedSubmissionId === id) setSelectedSubmissionId('');
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not delete registration');
    } finally {
      setDeletingSubmissionId('');
    }
  };

  const updateMatchReviewStatus = async (
    fromSubmissionId: string,
    toSubmissionId: string,
    score: number,
    status: 'approved' | 'rejected',
  ) => {
    if (!eventId) return;
    try {
      const { error: upsertErr } = await supabase.from('event_match_reviews').upsert({
        event_id: eventId,
        from_submission_id: fromSubmissionId,
        to_submission_id: toSubmissionId,
        score,
        status,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update review status');
    }
  };

  const setReviewStatus = async (toSubmissionId: string, score: number, status: 'approved' | 'rejected') => {
    if (!eventId || !selectedSubmission) return;
    await updateMatchReviewStatus(selectedSubmission.id, toSubmissionId, score, status);
  };

  const scheduleApprovedMatch = async (review: EventMatchReview) => {
    if (!eventId || !scheduleStart || !scheduleEnd) {
      setError('Pick start and end time before scheduling.');
      return;
    }
    const start = new Date(scheduleStart).toISOString();
    const end = new Date(scheduleEnd).toISOString();
    if (new Date(end) <= new Date(start)) {
      setError('End time must be after start time.');
      return;
    }
    const conflicts = scheduledMeetings.some((m) => {
      const samePair =
        (m.submission_a_id === review.from_submission_id || m.submission_b_id === review.from_submission_id) ||
        (m.submission_a_id === review.to_submission_id || m.submission_b_id === review.to_submission_id);
      if (!samePair) return false;
      return new Date(start) < new Date(m.end_time) && new Date(end) > new Date(m.start_time);
    });
    if (conflicts) {
      setError('Scheduling conflict detected for one of these participants.');
      return;
    }
    try {
      const { error: insErr } = await supabase.from('event_match_scheduled_meetings').insert({
        event_id: eventId,
        review_id: review.id,
        submission_a_id: review.from_submission_id,
        submission_b_id: review.to_submission_id,
        start_time: start,
        end_time: end,
        location: scheduleLocation.trim() || null,
        status: 'scheduled',
      });
      if (insErr) throw insErr;
      setScheduleLocation('');
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not schedule match');
    }
  };

  const exportScheduleCsv = () => {
    const idToSubmission = new Map(submissions.map((s) => [s.id, s]));
    const header = ['participant_a', 'participant_b', 'company_a', 'company_b', 'start_time', 'end_time', 'location', 'status'];
    const rows = scheduledMeetings.map((m) => {
      const a = idToSubmission.get(m.submission_a_id);
      const b = idToSubmission.get(m.submission_b_id);
      return [
        [a?.first_name, a?.last_name].filter(Boolean).join(' '),
        [b?.first_name, b?.last_name].filter(Boolean).join(' '),
        a?.company_name ?? '',
        b?.company_name ?? '',
        m.start_time,
        m.end_time,
        m.location ?? '',
        m.status,
      ];
    });
    const csv = [header, ...rows]
      .map((line) => line.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-${eventId}-scheduled-meetings.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const installDefaultTemplates = async () => {
    if (!eventId) return;
    if (ensuringDefaults) return;
    setEnsuringDefaults(true);
    setTemplateError('');
    setFormError('');
    setQuestionError('');
    try {
      let workingForms = [...forms];

      const upsertTemplate = async (audience: MatchmakingAudience, name: string, templateQuestions: TemplateQuestion[]) => {
        let form = workingForms.find((f) => f.audience === audience && f.name === name) ?? null;
        const legacyForms = workingForms.filter((f) => f.audience === audience && isLegacyMeetMaxName(f.name));

        if (!form && legacyForms.length > 0) {
          const primaryLegacy = legacyForms[0];
          if (primaryLegacy) {
            const { data: renamedLegacy, error: renameErr } = await supabase
              .from('event_registration_forms')
              .update({ name })
              .eq('id', primaryLegacy.id)
              .select('*')
              .single();
            if (renameErr) throw renameErr;
            form = renamedLegacy as EventRegistrationForm;
            workingForms = workingForms.map((f) => (f.id === form?.id ? form : f));
          }
        }

        if (form && legacyForms.length > 0) {
          for (const legacyForm of legacyForms) {
            if (legacyForm.id === form.id) continue;
            const legacySafeName = `KBM Legacy ${titleizeAudience(audience)} Registration (${legacyForm.id.slice(0, 6)})`;
            const { data: renamedLegacy, error: renameLegacyErr } = await supabase
              .from('event_registration_forms')
              .update({ name: legacySafeName })
              .eq('id', legacyForm.id)
              .select('*')
              .single();
            if (renameLegacyErr) throw renameLegacyErr;
            const updatedLegacy = renamedLegacy as EventRegistrationForm;
            workingForms = workingForms.map((f) => (f.id === updatedLegacy.id ? updatedLegacy : f));
          }
        }

        if (!form) {
          const nextSort = workingForms.length > 0 ? Math.max(...workingForms.map((f) => f.sort_order)) + 1 : 0;
          const { data: createdForm, error: formInsertErr } = await supabase
            .from('event_registration_forms')
            .insert({
              event_id: eventId,
              name,
              audience,
              is_active: true,
              sort_order: nextSort,
              section_order: defaultSectionOrderForAudience(audience),
            })
            .select('*')
            .single();
          if (formInsertErr) throw formInsertErr;
          form = createdForm as EventRegistrationForm;
          workingForms = [...workingForms, form];
        }

        const existingQuestions = questions.filter((q) => q.form_id === form.id);
        const existingByPrompt = new Map(existingQuestions.map((q) => [q.prompt.trim().toLowerCase(), q]));
        const templatePromptNorms = new Set(templateQuestions.map((q) => normalizeRegistrationPrompt(q.prompt)));
        const legacyHiddenNorms = new Set(
          LEGACY_DELEGATE_STAGE2_HIDDEN_PROMPTS.map((p) => normalizeRegistrationPrompt(p)),
        );

        let rollingSectionHeading: string | null = null;
        for (const [idx, q] of templateQuestions.entries()) {
          if (q.section_label?.trim()) {
            rollingSectionHeading = q.section_label.trim();
          }
          const sectionForDb = sectionLabelForDatabase(rollingSectionHeading);

          const existing = existingByPrompt.get(q.prompt.trim().toLowerCase());
          if (existing) {
            // Keep base template questions aligned with KBM wording/type/required flags.
            const { error: patchErr } = await supabase
              .from('event_registration_questions')
              .update({
                question_type: q.question_type,
                is_required: q.is_required ?? false,
                section_label: sectionForDb,
                is_base_question: true,
                is_hidden: isRegistrationQuestionHiddenByDefault(audience, q.prompt),
                sort_order: idx,
              })
              .eq('id', existing.id);
            if (patchErr) throw patchErr;
            if (q.options && q.options.length > 0) {
              const { data: existingOptions, error: optLoadErr } = await supabase
                .from('event_registration_question_options')
                .select('*')
                .eq('question_id', existing.id)
                .order('sort_order', { ascending: true });
              if (optLoadErr) throw optLoadErr;
              const existingOptionRows = (existingOptions as EventRegistrationQuestionOption[]) ?? [];
              const normalizedTemplateValues = new Set(q.options.map((value) => value.trim().toLowerCase()));
              const existingValues = new Set(existingOptionRows.map((o) => o.value.trim().toLowerCase()));
              const staleOptionIds = existingOptionRows
                .filter((opt) => !normalizedTemplateValues.has(opt.value.trim().toLowerCase()))
                .map((opt) => opt.id);
              if (staleOptionIds.length > 0) {
                const { error: optDeleteErr } = await supabase
                  .from('event_registration_question_options')
                  .delete()
                  .in('id', staleOptionIds);
                if (optDeleteErr) throw optDeleteErr;
              }
              const missing = q.options
                .filter((value) => !existingValues.has(value.trim().toLowerCase()))
                .map((value, optionIdx) => ({
                  question_id: existing.id,
                  label: value,
                  value,
                  sort_order: optionIdx + existingOptionRows.length,
                }));
              if (missing.length > 0) {
                const { error: optInsErr } = await supabase.from('event_registration_question_options').insert(missing);
                if (optInsErr) throw optInsErr;
              }
            }
            continue;
          }
          const { data: insertedQuestion, error: questionInsertErr } = await supabase
            .from('event_registration_questions')
            .insert({
              form_id: form.id,
              prompt: q.prompt,
              question_type: q.question_type,
              is_required: q.is_required ?? false,
              section_label: sectionForDb,
              is_base_question: true,
              is_hidden: isRegistrationQuestionHiddenByDefault(audience, q.prompt),
              sort_order: idx,
            })
            .select('*')
            .single();
          if (questionInsertErr) throw questionInsertErr;

          if (q.options && q.options.length > 0) {
            const optionRows = q.options.map((value, optionIdx) => ({
              question_id: (insertedQuestion as EventRegistrationQuestion).id,
              label: value,
              value,
              sort_order: optionIdx,
            }));
            const { error: optionsErr } = await supabase.from('event_registration_question_options').insert(optionRows);
            if (optionsErr) throw optionsErr;
          }
        }

        const toHideDeprecated = existingQuestions.filter((q) => {
          if (!q.is_base_question || q.is_hidden) return false;
          const norm = normalizeRegistrationPrompt(q.prompt);
          if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return true;
          if (audience === 'attendee' && legacyHiddenNorms.has(norm)) return true;
          return !templatePromptNorms.has(norm);
        });
        for (const q of toHideDeprecated) {
          const { error: hideErr } = await supabase.from('event_registration_questions').update({ is_hidden: true }).eq('id', q.id);
          if (hideErr) throw hideErr;
        }
      };

      await upsertTemplate('attendee', KBM_ATTENDEE_FORM_NAME, ATTENDEE_TEMPLATE_QUESTIONS);
      await upsertTemplate('vendor', KBM_VENDOR_FORM_NAME, VENDOR_TEMPLATE_QUESTIONS);
      await upsertTemplate('user', SPEAKER_FORM_NAME, SPEAKER_TEMPLATE_QUESTIONS);
      await load();
    } catch (e) {
      setTemplateError(postgrestErrorMessage(e) || 'Could not install default templates');
    } finally {
      setEnsuringDefaults(false);
    }
  };

  useEffect(() => {
    if (!eventId || loading || didInitialDefaultSync) return;
    if (!ensuringDefaults) {
      setDidInitialDefaultSync(true);
      void installDefaultTemplates();
    }
  }, [eventId, loading, didInitialDefaultSync, ensuringDefaults]);

  useEffect(() => {
    if (!selectedQuestionId) {
      editHydratedForQuestionIdRef.current = null;
      questionEditTouchedRef.current = false;
      setEditingQuestionPrompt('');
      setEditingQuestionType('text');
      setEditingQuestionRequired(false);
      setEditingQuestionSectionLabel('');
      setEditingQuestionUsedInMatching(false);
      return;
    }
    const q = questions.find((item) => item.id === selectedQuestionId);
    if (!q) return;

    const alreadyHydrated = editHydratedForQuestionIdRef.current === selectedQuestionId;
    if (!alreadyHydrated) {
      editHydratedForQuestionIdRef.current = selectedQuestionId;
      questionEditTouchedRef.current = false;
      setEditingQuestionPrompt(q.prompt);
      setEditingQuestionType(q.question_type);
      setEditingQuestionRequired(Boolean(q.is_required));
      setEditingQuestionSectionLabel(q.section_label ?? '');
      setEditingQuestionUsedInMatching(Boolean(q.used_in_matching));
      return;
    }

    if (!questionEditTouchedRef.current) {
      setEditingQuestionPrompt(q.prompt);
      setEditingQuestionType(q.question_type);
      setEditingQuestionRequired(Boolean(q.is_required));
      setEditingQuestionSectionLabel(q.section_label ?? '');
      setEditingQuestionUsedInMatching(Boolean(q.used_in_matching));
    }
  }, [selectedQuestionId, questions]);

  useEffect(() => {
    if (!selectedQuestionId) return;
    const frame = requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      questionEditorAnchorRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedQuestionId]);

  useEffect(() => {
    setQuestionSectionPick('');
    setQuestionSectionLabel('');
    setQuestionSearchQuery('');
  }, [selectedFormId]);

  useEffect(() => {
    if (!editFormDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editFormDirty]);

  useEffect(() => {
    if (!activeForm || activeQuestions.length === 0 || repairingSections) return;
    const sectionMap = sectionMapForAudience(activeForm.audience);
    const toRepair = activeQuestions
      .map((q) => {
        const expectedSection = sectionMap.get(normalizePrompt(q.prompt));
        const nextSection = expectedSection ?? canonicalSectionLabel(q.section_label);
        const currentSection = canonicalSectionLabel(q.section_label);
        if (nextSection === currentSection) return null;
        return { id: q.id, section_label: nextSection === 'General' ? null : nextSection };
      })
      .filter((item): item is { id: string; section_label: string | null } => Boolean(item));
    if (toRepair.length === 0) return;

    let cancelled = false;
    setRepairingSections(true);
    setQuestionError('');
    void (async () => {
      try {
        for (const repair of toRepair) {
          const { error: updErr } = await supabase
            .from('event_registration_questions')
            .update({ section_label: repair.section_label })
            .eq('id', repair.id);
          if (updErr) throw updErr;
        }
        if (cancelled) return;
        const patchMap = new Map(toRepair.map((item) => [item.id, item.section_label]));
        setQuestions((prev) =>
          prev.map((q) => (patchMap.has(q.id) ? { ...q, section_label: patchMap.get(q.id) ?? null } : q))
        );
      } catch (e) {
        if (!cancelled) setQuestionError(postgrestErrorMessage(e) || 'Could not auto-organize legacy sections');
      } finally {
        if (!cancelled) setRepairingSections(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeForm, activeQuestions, repairingSections]);

  useEffect(() => {
    if (!eventId || !tabParam) return;
    if (parseMatchmakingTab(tabParam)) return;
    navigate(`/events/${eventId}/matchmaking/portal`, { replace: true });
  }, [eventId, tabParam, navigate]);

  useEffect(() => {
    if (!eventId || tabParam) return;
    navigate(`/events/${eventId}/matchmaking/portal`, { replace: true });
  }, [eventId, tabParam, navigate]);

  const setupChecklist = useMemo(
    () => [
      { label: 'Registration open', done: registrationOpen },
      { label: 'Stage 2 active (delegate or vendor)', done: delegateStage2Active || vendorStage2Active },
      { label: 'Registration forms configured', done: forms.length > 0 },
      { label: 'Questions added to active form', done: activeQuestions.length > 0 },
    ],
    [registrationOpen, delegateStage2Active, vendorStage2Active, forms.length, activeQuestions.length]
  );

  const setupCompleteCount = setupChecklist.filter((item) => item.done).length;

  const activeTabMeta =
    MATCHMAKING_TABS.find((tab) => tab.id === activeTab) ?? MATCHMAKING_TABS[0]!;

  const registrationStats = useMemo(() => {
    const rows = filteredSubmissions;
    return {
      total: rows.length,
      submitted: rows.filter((row) => row.status === 'submitted').length,
      pendingReview: rows.filter((row) => (row.registration_status ?? 'pending_review') === 'pending_review').length,
      approved: rows.filter((row) => row.registration_status === 'approved').length,
    };
  }, [filteredSubmissions]);

  function goToTab(tab: MatchmakingTab) {
    if (!eventId) return;
    navigate(`/events/${eventId}/matchmaking/${tab}`);
  }

  if (!eventId) return <div className={styles.error}>Missing event</div>;
  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
        <h1>Matchmaking setup — {event?.name ?? 'Event'}</h1>
        <p className={styles.hint}>
          Configure delegate/vendor/speaker registration forms and collect submissions for admin review.
        </p>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.tabBarSticky}>
        <nav className={styles.tabs} aria-label="Matchmaking sections">
          {MATCHMAKING_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => goToTab(id)}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className={styles.tabContent}>
      <TabIntro title={activeTabMeta.introTitle} description={activeTabMeta.intro} />

      {activeTab === 'portal' ? (
        <section className={styles.setupChecklist}>
          <div className={styles.setupChecklistHead}>
            <h2>Setup checklist</h2>
            <span className={styles.setupChecklistProgress}>
              {setupCompleteCount}/{setupChecklist.length} complete
            </span>
          </div>
          <ul className={styles.setupChecklistList}>
            {setupChecklist.map((item) => (
              <li key={item.label} className={item.done ? styles.setupChecklistDone : undefined}>
                <span aria-hidden>{item.done ? '✓' : '○'}</span> {item.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeTab === 'portal' ? (
      <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Registration portal</h2>
          <StatusBadge
            label={registrationOpen ? 'Open' : 'Closed'}
            tone={registrationOpen ? 'success' : 'muted'}
          />
        </div>
        <p className={styles.sectionLead}>
          Turn registration on when you are ready to accept sign-ups. Copy the links below for delegates, vendors, and speakers.
        </p>
        <label className={styles.toggleCard}>
          <input
            type="checkbox"
            checked={registrationOpen}
            onChange={(e) => void saveSettings(e.target.checked)}
            disabled={savingSettings}
          />
          <span>
            <strong>Registration open</strong>
            <span className={styles.toggleCardHint}>
              {registrationOpen ? 'New sign-ups are allowed on connect.' : 'Registration links show as closed.'}
            </span>
          </span>
        </label>
        <div className={styles.linkCardGrid}>
          <CopyLinkCard label="Delegate registration" hint="Stage 1 sign-up" url={publicRegisterUrl(eventId, 'delegate')} />
          <CopyLinkCard label="Vendor registration" hint="Stage 1 sign-up" url={publicRegisterUrl(eventId, 'vendor')} />
          <CopyLinkCard label="Speaker registration" hint="Stage 1 sign-up" url={publicRegisterUrl(eventId, 'speaker')} />
          <CopyLinkCard label="Delegate portal login" hint="After account created" url={publicPortalLoginUrl(eventId, 'delegate')} />
          <CopyLinkCard label="Vendor portal login" hint="After account created" url={publicPortalLoginUrl(eventId, 'vendor')} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Connect portal banner</h2>
        </div>
        <p className={styles.sectionLead}>
          {PORTAL_BANNER_HINT} Recommended size: <strong>{PORTAL_BANNER_SIZE_LABEL}</strong>.
          Shown at the top of connect.kbmcollective.org when delegates and vendors sign in. Leave empty to use the event logo on a navy header.
        </p>
        <input
          ref={portalBannerInputRef}
          type="file"
          accept={PORTAL_BANNER_FILE_ACCEPT}
          className={styles.hiddenFileInput}
          onChange={onPortalBannerFile}
        />
        {portalBannerPreviewSrc ? (
          <div className={styles.portalBannerPreviewWrap}>
            <img src={portalBannerPreviewSrc} alt="" className={styles.portalBannerPreview} />
          </div>
        ) : (
          <div className={styles.portalBannerPreviewPlaceholder}>No wide portal banner yet — logo-only header for now</div>
        )}
        <div className={styles.portalBannerActions}>
          <button
            type="button"
            disabled={uploadingPortalBanner}
            onClick={() => portalBannerInputRef.current?.click()}
          >
            {uploadingPortalBanner
              ? 'Uploading…'
              : event?.portal_banner_url
                ? 'Replace portal banner'
                : 'Upload portal banner'}
          </button>
          {event?.portal_banner_url ? (
            <button type="button" disabled={uploadingPortalBanner} onClick={() => void onClearPortalBanner()}>
              Remove portal banner
            </button>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Stage 2 portal activation</h2>
        </div>
        <p className={styles.sectionLead}>
          Stage 1 collects account info. When Stage 2 is active, registrants sign in and complete their full profile. Until then they see the holding screen.
        </p>
        <div className={styles.formStack}>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={delegateStage2Active} onChange={(e) => setDelegateStage2Active(e.target.checked)} />
            <span>
              <strong>Delegate Stage 2 active</strong>
              <span className={styles.toggleCardHint}>Delegates can complete Registration Details.</span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={vendorStage2Active} onChange={(e) => setVendorStage2Active(e.target.checked)} />
            <span>
              <strong>Vendor Stage 2 active</strong>
              <span className={styles.toggleCardHint}>Vendors can complete their full vendor profile.</span>
            </span>
          </label>
          <label className={styles.field}>
            <span>Expected open date (optional)</span>
            <input
              type="datetime-local"
              value={stage2ExpectedOpenAt}
              onChange={(e) => setStage2ExpectedOpenAt(e.target.value)}
            />
            <span className={styles.fieldHelp}>Shown on the holding screen and in confirmation email.</span>
          </label>
          <label className={styles.field}>
            <span>Holding screen message</span>
            <textarea
              value={stage2HoldingMessage}
              onChange={(e) => setStage2HoldingMessage(e.target.value)}
              rows={4}
              placeholder="Your registration is confirmed! Full profile setup opens soon — we will email you when it is ready."
            />
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} disabled={savingPortalSettings} onClick={() => void savePortalSettings()}>
              {savingPortalSettings ? 'Saving…' : 'Save Stage 2 settings'}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Delegate portal (after registration)</h2>
        </div>
        <p className={styles.sectionLead}>
          Control optional delegate menu items and who gets notified when someone submits registration.
        </p>
        <div className={styles.formStack}>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={meetingRequestsOpen} onChange={(e) => setMeetingRequestsOpen(e.target.checked)} />
            <span>
              <strong>Meeting requests open</strong>
              <span className={styles.toggleCardHint}>Shows Meeting Requests in the delegate and vendor menus.</span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={delegateHotelVisible} onChange={(e) => setDelegateHotelVisible(e.target.checked)} />
            <span>
              <strong>Show Hotel tab</strong>
              <span className={styles.toggleCardHint}>Display hotel info in the delegate portal.</span>
            </span>
          </label>
          <label className={styles.field}>
            <span>Hotel tab content</span>
            <textarea
              value={delegateHotelContent}
              onChange={(e) => setDelegateHotelContent(e.target.value)}
              rows={6}
              placeholder="Hotel address, included nights, booking link, check-in/out times, confirmation notes…"
            />
          </label>
          <label className={styles.field}>
            <span>Team notification emails</span>
            <input
              value={registrationNotifyTeamEmails}
              onChange={(e) => setRegistrationNotifyTeamEmails(e.target.value)}
              placeholder="ops@example.com, events@example.com"
            />
            <span className={styles.fieldHelp}>Comma-separated. Notified when someone submits registration.</span>
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} onClick={() => void savePortalSettings()} disabled={savingPortalSettings}>
              {savingPortalSettings ? 'Saving…' : 'Save portal settings'}
            </button>
          </div>
        </div>
      </section>
      </>
      ) : null}

      {activeTab === 'forms' ? (
      <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Registration forms</h2>
        </div>
        <p className={styles.sectionLead}>
          Master Build Spec defaults use six delegate sections. Legacy KBM fields stay in the database but are hidden on connect unless you show them here.
        </p>
        {templateError ? <p className={styles.error}>{templateError}</p> : null}
        <div className={styles.inlineForm}>
          <input
            value={newFormName}
            onChange={(e) => setNewFormName(e.target.value)}
            placeholder="e.g. Vendor onboarding"
          />
          <select value={newFormAudience} onChange={(e) => setNewFormAudience(e.target.value as MatchmakingAudience)}>
            <option value="attendee">Delegate</option>
            <option value="vendor">Vendor</option>
            <option value="user">Speaker</option>
          </select>
          <button type="button" onClick={() => void addForm()} disabled={savingForm}>
            {savingForm ? 'Adding…' : 'Add form'}
          </button>
        </div>
        {formError ? <p className={styles.error}>{formError}</p> : null}
        {forms.length === 0 ? (
          <p className={styles.hint}>No forms yet. Create a delegate/vendor/speaker form to begin.</p>
        ) : (
          <div className={styles.formsGrid}>
            {visibleForms.map((form) => (
              <button
                key={form.id}
                type="button"
                className={`${styles.formCard} ${selectedFormId === form.id ? styles.formCardActive : ''}`}
                onClick={() => setSelectedFormId(form.id)}
              >
                <strong>{toDisplayFormName(form)}</strong>
                <span>{titleizeAudience(form.audience)}</span>
                <span>{form.is_active ? 'Active' : 'Inactive'}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Solution categories</h2>
        </div>
        <p className={styles.sectionLead}>
          Define the solution types delegates can select. These feed solution-interest questions and match scoring.
        </p>
        {eventId ? <MatchmakingSolutionCategories eventId={eventId} /> : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Questions {activeForm ? `— ${activeForm.name}` : ''}</h2>
          {activeForm ? (
            <StatusBadge label={titleizeAudience(activeForm.audience)} tone="info" />
          ) : null}
        </div>
        {!activeForm ? (
          <p className={styles.hint}>Select a form to add questions.</p>
        ) : (
          <div className={styles.workbench}>
            <div className={styles.questionsToolbar}>
              <input
                type="search"
                value={questionSearchQuery}
                onChange={(e) => setQuestionSearchQuery(e.target.value)}
                placeholder="Search questions…"
                className={styles.questionsToolbarSearch}
                aria-label="Search questions"
              />
              <select
                value={sectionFilterLabel}
                onChange={(e) => setSectionFilterLabel(e.target.value)}
                className={styles.questionsToolbarSelect}
                aria-label="Filter by section"
              >
                <option value="all">All sections</option>
                {sectionFilterChoices.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              {hiddenLegacyQuestionCount > 0 ? (
                <label className={styles.questionsToolbarLegacy}>
                  <input
                    type="checkbox"
                    checked={showHiddenLegacyQuestions}
                    onChange={(e) => setShowHiddenLegacyQuestions(e.target.checked)}
                  />
                  Show {hiddenLegacyQuestionCount} hidden legacy
                </label>
              ) : null}
            </div>

            <div className={styles.addSectionBar}>
              <input
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="New section name…"
                aria-label="New section name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addEmptySection();
                }}
              />
              <button type="button" className={styles.btnPrimary} onClick={() => void addEmptySection()} disabled={sectionBusy || !newSectionName.trim()}>
                Add section
              </button>
            </div>

            {repairingSections ? <p className={styles.hint}>Auto-organizing legacy questions into the right sections…</p> : null}
            {questionError ? <p className={styles.error}>{questionError}</p> : null}

            <div className={styles.questionsEditorSplit}>
              <div className={styles.questionsListColumn}>
                {activeSectionGroups.length === 0 ? (
                  <p className={styles.hint}>No sections yet. Add a section above, then add questions to it.</p>
                ) : filteredQuestionSectionGroups.length === 0 ? (
                  <p className={styles.hint}>No questions match your search or filters. Clear search or choose “All sections”.</p>
                ) : (
                  <div className={styles.sectionStack}>
                    {filteredQuestionSectionGroups.map((group) => {
                      const sectionIdx = activeFormSectionOrder.indexOf(group.label);
                      const canMoveSectionUp = sectionIdx > 0 && group.label !== 'General';
                      const canMoveSectionDown =
                        sectionIdx >= 0 && sectionIdx < activeFormSectionOrder.length - 1 && group.label !== 'General';
                      const sectionCollapsed = Boolean(collapsedSections[group.label]);
                      const sectionAllHidden = group.items.length > 0 && group.items.every((q) => q.is_hidden);
                      const showAddForm = addingQuestionToSection === group.label;
                      return (
                      <div key={group.label} className={styles.sectionBlock}>
                        <div className={styles.sectionHead}>
                          <button
                            type="button"
                            className={styles.sectionTitleBtn}
                            onClick={() => toggleSectionCollapsed(group.label)}
                            aria-expanded={!sectionCollapsed}
                          >
                            <span className={styles.sectionChevron} aria-hidden>{sectionCollapsed ? '▸' : '▾'}</span>
                            <h3>{group.label}</h3>
                            <span className={styles.sectionCount}>
                              {group.items.length} question{group.items.length === 1 ? '' : 's'}
                            </span>
                          </button>
                          <div className={styles.sectionHeadActions}>
                            {group.label !== 'General' ? (
                              <>
                                <button type="button" className={styles.btnIcon} disabled={sectionBusy || !canMoveSectionUp} onClick={() => void moveSection(group.label, -1)} aria-label="Move section up">↑</button>
                                <button type="button" className={styles.btnIcon} disabled={sectionBusy || !canMoveSectionDown} onClick={() => void moveSection(group.label, 1)} aria-label="Move section down">↓</button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              onClick={() => openAddQuestionToSection(group.label)}
                              disabled={sectionBusy || showAddForm}
                            >
                              + Add question
                            </button>
                            {group.label !== 'General' ? (
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() => beginRenameSection(group.label)}
                                disabled={sectionBusy || renamingSectionLabel === group.label}
                              >
                                Rename
                              </button>
                            ) : null}
                            {group.items.length > 0 ? (
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() => { setSectionFromLabel(group.label); void setSectionHidden(group.label, !sectionAllHidden); }}
                                disabled={sectionBusy}
                              >
                                {sectionAllHidden ? 'Show section' : 'Hide section'}
                              </button>
                            ) : null}
                            {group.label !== 'General' ? (
                              <button
                                type="button"
                                className={styles.btnDangerOutline}
                                onClick={() => { setSectionFromLabel(group.label); void deleteSection(group.label); }}
                                disabled={sectionBusy}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {renamingSectionLabel === group.label ? (
                          <div className={styles.inlineRenameRow}>
                            <input
                              value={sectionRenameLabel}
                              onChange={(e) => setSectionRenameLabel(e.target.value)}
                              placeholder="Section name"
                              aria-label="Rename section"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void renameSection(group.label, sectionRenameLabel);
                                if (e.key === 'Escape') cancelRenameSection();
                              }}
                            />
                            <button type="button" className={styles.btnPrimary} onClick={() => void renameSection(group.label, sectionRenameLabel)} disabled={sectionBusy}>
                              Save
                            </button>
                            <button type="button" className={styles.btnSecondary} onClick={cancelRenameSection} disabled={sectionBusy}>
                              Cancel
                            </button>
                          </div>
                        ) : null}

                        {!sectionCollapsed ? (
                          <>
                            {showAddForm ? (
                              <div className={styles.sectionAddForm}>
                                <label className={styles.field}>
                                  <span>Question text</span>
                                  <input
                                    value={questionPrompt}
                                    onChange={(e) => setQuestionPrompt(e.target.value)}
                                    placeholder="e.g. Please list your top 5 priorities for 2026"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void addQuestion(group.label);
                                    }}
                                  />
                                </label>
                                <label className={styles.field}>
                                  <span>Answer type</span>
                                  <select value={questionType} onChange={(e) => setQuestionType(e.target.value as MatchmakingQuestionType)}>
                                    {QUESTION_TYPE_OPTIONS.map((qt) => (
                                      <option value={qt} key={qt}>
                                        {qt}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className={styles.checkboxInline}>
                                  <input
                                    type="checkbox"
                                    checked={questionRequired}
                                    onChange={(e) => setQuestionRequired(e.target.checked)}
                                  />
                                  Required
                                </label>
                                <div className={styles.sectionAddFormActions}>
                                  <button type="button" className={styles.btnPrimary} onClick={() => void addQuestion(group.label)} disabled={savingQuestion}>
                                    {savingQuestion ? 'Adding…' : 'Add question'}
                                  </button>
                                  <button type="button" className={styles.btnSecondary} onClick={cancelAddQuestionToSection} disabled={savingQuestion}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {group.items.length === 0 && !showAddForm ? (
                              <p className={styles.sectionEmptyHint}>
                                No questions yet. Click <strong>+ Add question</strong> to add one to this section.
                              </p>
                            ) : null}

                            {group.items.length > 0 ? (
                            <ul className={styles.list}>
                              {group.items.map((q) => (
                                <li key={q.id} className={`${styles.questionRow} ${selectedQuestionId === q.id ? styles.questionRowSelected : ''}`}>
                                  <div className={styles.questionRowMain}>
                                    <button type="button" className={styles.qSelectBtn} onClick={() => setSelectedQuestionId(q.id)}>
                                      <strong>{q.prompt}</strong>
                                      <span className={styles.questionMeta}>
                                        <span className={styles.typePill}>{q.question_type}</span>
                                        {q.is_required ? <span className={styles.requiredPill}>Required</span> : null}
                                        {q.is_base_question ? <span className={styles.baseTag}>base</span> : null}
                                        {q.used_in_matching ? <span className={styles.requiredPill}>matching</span> : null}
                                        {q.is_hidden ? <span className={styles.hiddenPill}>Hidden</span> : null}
                                      </span>
                                    </button>
                                  </div>
                                  <div className={styles.questionRowActions}>
                                    <button type="button" className={styles.btnSecondary} onClick={() => setSelectedQuestionId(q.id)}>
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.btnSecondary}
                                      disabled={Boolean(duplicatingQuestionId)}
                                      onClick={() => void duplicateQuestion(q.id)}
                                    >
                                      {duplicatingQuestionId === q.id ? 'Copying…' : 'Duplicate'}
                                    </button>
                                    <button type="button" className={styles.btnSecondary} onClick={() => void toggleQuestionHidden(q.id, !Boolean(q.is_hidden))}>
                                      {q.is_hidden ? 'Show' : 'Hide'}
                                    </button>
                                    <button type="button" className={styles.btnIcon} onClick={() => void moveQuestion(q.id, -1)} aria-label="Move up">↑</button>
                                    <button type="button" className={styles.btnIcon} onClick={() => void moveQuestion(q.id, 1)} aria-label="Move down">↓</button>
                                    {!q.is_base_question ? (
                                      <button type="button" className={styles.btnDangerOutline} onClick={() => void deleteQuestion(q.id)}>Delete</button>
                                    ) : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div ref={questionEditorAnchorRef} className={styles.questionEditorColumn}>
                {!selectedQuestion ? (
                  <div className={`${styles.panel} ${styles.panelMuted}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Question editor</span>
                    </div>
                    <div className={styles.panelBody}>
                      <p className={styles.hint}>
                        Choose <strong>Edit</strong> or click a question row. On wide screens this panel stays beside the list while you scroll.
                      </p>
                    </div>
                  </div>
                ) : null}
                {selectedQuestion ? (
                  <div className={`${styles.panel} ${styles.panelAccent}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Edit selected question</span>
                      {editFormDirty ? (
                        <span className={styles.unsavedPill} role="status">
                          Unsaved changes — click Save question
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.panelBody}>
                      <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                          <span>Question text</span>
                          <input
                            value={editingQuestionPrompt}
                            onChange={(e) => {
                              questionEditTouchedRef.current = true;
                              setEditingQuestionPrompt(e.target.value);
                            }}
                            placeholder="Question prompt"
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Answer type</span>
                          <select
                            value={editingQuestionType}
                            onChange={(e) => {
                              questionEditTouchedRef.current = true;
                              setEditingQuestionType(e.target.value as MatchmakingQuestionType);
                            }}
                          >
                            {QUESTION_TYPE_OPTIONS.map((qt) => (
                              <option value={qt} key={qt}>
                                {qt}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className={`${styles.field} ${styles.fieldCheckbox}`}>
                          <span>Required</span>
                          <span className={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={editingQuestionRequired}
                              onChange={(e) => {
                                questionEditTouchedRef.current = true;
                                setEditingQuestionRequired(e.target.checked);
                              }}
                              id="edit-q-required"
                            />
                            <label htmlFor="edit-q-required">Must answer to submit</label>
                          </span>
                        </div>
                        {!['text', 'textarea', 'email'].includes(editingQuestionType) ? (
                          <div className={`${styles.field} ${styles.fieldCheckbox}`}>
                            <span>1:1 matching</span>
                            <span className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={editingQuestionUsedInMatching}
                                onChange={(e) => {
                                  questionEditTouchedRef.current = true;
                                  setEditingQuestionUsedInMatching(e.target.checked);
                                }}
                                id="edit-q-matching"
                              />
                              <label htmlFor="edit-q-matching">Use in structured match scoring</label>
                            </span>
                          </div>
                        ) : null}
                        {selectedQuestion.is_base_question ? (
                          <p className={styles.hint}>Base questions are locked — you can hide/show and toggle matching, but not delete.</p>
                        ) : null}
                        <label className={styles.field}>
                          <span>Quick section</span>
                          <select
                            key={selectedQuestion.id}
                            defaultValue=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) return;
                              questionEditTouchedRef.current = true;
                              setEditingQuestionSectionLabel(v === '__general__' ? '' : v);
                            }}
                            aria-label="Apply a preset section"
                          >
                            <option value="">Choose preset…</option>
                            <option value="__general__">General</option>
                            {addQuestionSectionPickOptions.map((label) => (
                              <option key={label} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field}>
                          <span>Section label</span>
                          <input
                            value={editingQuestionSectionLabel}
                            onChange={(e) => {
                              questionEditTouchedRef.current = true;
                              setEditingQuestionSectionLabel(e.target.value);
                            }}
                            placeholder="Section (optional)"
                          />
                        </label>
                      </div>
                      <div className={styles.panelActions}>
                        <button type="button" className={styles.btnPrimary} onClick={() => void saveQuestionEdits()} disabled={savingQuestionEdit}>
                          {savingQuestionEdit ? 'Saving…' : 'Save question'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {selectedQuestion && (selectedQuestion.question_type === 'single_select' || selectedQuestion.question_type === 'multi_select') ? (
                  <div className={`${styles.panel} ${styles.optionPanel}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Answer choices</span>
                      <span className={styles.panelHint}>{selectedQuestion.prompt}</span>
                    </div>
                    <div className={`${styles.optionEditor} ${styles.panelBody}`}>
                      <div className={styles.inlineForm}>
                        <input
                          value={newOptionLabel}
                          onChange={(e) => setNewOptionLabel(e.target.value)}
                          placeholder="Add option label"
                        />
                        <button type="button" onClick={() => void addOptionToSelected()}>
                          Add option
                        </button>
                      </div>
                      {optionError ? <p className={styles.error}>{optionError}</p> : null}
                      <ul className={styles.optionList}>
                        {selectedQuestionOptions.map((opt) => (
                          <li key={opt.id} className={styles.optionRow}>
                            {editingOptionId === opt.id ? (
                              <>
                                <input
                                  value={editingOptionLabel}
                                  onChange={(e) => setEditingOptionLabel(e.target.value)}
                                  placeholder="Option label"
                                />
                                <span className={styles.qMoveBtns}>
                                  <button type="button" onClick={() => void saveOptionEdit()} disabled={savingOptionEdit}>
                                    {savingOptionEdit ? 'Saving…' : 'Save'}
                                  </button>
                                  <button type="button" onClick={() => { setEditingOptionId(''); setEditingOptionLabel(''); }}>
                                    Cancel
                                  </button>
                                </span>
                              </>
                            ) : (
                              <>
                                <span>{opt.label}</span>
                                <span className={styles.qMoveBtns}>
                                  <button type="button" onClick={() => void moveOption(opt.id, -1)}>↑</button>
                                  <button type="button" onClick={() => void moveOption(opt.id, 1)}>↓</button>
                                  <button type="button" onClick={() => beginEditOption(opt)}>Edit</button>
                                  <button type="button" onClick={() => void deleteOption(opt.id)}>Delete</button>
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
      </>
      ) : null}

      {activeTab === 'registrations' ? (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Recent registrations</h2>
          <StatusBadge label={`${registrationStats.total} total`} tone="info" />
        </div>
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{registrationStats.submitted}</span>
            <span className={styles.statLabel}>Submitted</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{registrationStats.pendingReview}</span>
            <span className={styles.statLabel}>Pending review</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{registrationStats.approved}</span>
            <span className={styles.statLabel}>Approved</span>
          </div>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            <span>Form status</span>
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value as 'all' | 'submitted' | 'draft')}>
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Audience</span>
            <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as 'all' | MatchmakingAudience)}>
              <option value="all">All audiences</option>
              <option value="attendee">Delegate</option>
              <option value="vendor">Vendor</option>
              <option value="user">Speaker</option>
            </select>
          </label>
          <div className={styles.toolbarActions}>
            <button type="button" className={styles.btnSecondary} onClick={exportSubmissionsCsv}>
              Export CSV
            </button>
          </div>
        </div>
        {filteredSubmissions.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No registrations yet</strong>
            <p>When delegates and vendors sign up, they will appear here for review.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Form status</th>
                  <th>Review</th>
                  <th>Profile</th>
                  <th>Matching</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedSubmissionId === row.id ? styles.rowActive : undefined}
                    onClick={() => selectSubmissionForReview(row.id)}
                  >
                    <td>{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>{row.company_name ?? '—'}</td>
                    <td>{row.email ?? '—'}</td>
                    <td>{titleizeAudience(row.attendee_type)}</td>
                    <td><StatusBadge label={row.status} tone={formStatusTone(row.status)} /></td>
                    <td>
                      <StatusBadge
                        label={row.registration_status ?? 'pending_review'}
                        tone={registrationReviewTone(row.registration_status)}
                      />
                    </td>
                    <td>
                      <StatusBadge
                        label={row.profile_complete ? 'Complete' : 'Incomplete'}
                        tone={row.profile_complete ? 'success' : 'muted'}
                      />
                    </td>
                    <td>
                      {isMatchPoolEligible(row.attendee_type) ? (
                        <StatusBadge
                          label={row.matching_opt_in ? 'Opted in' : 'Opted out'}
                          tone={row.matching_opt_in ? 'success' : 'muted'}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectSubmissionForReview(row.id);
                        }}
                      >
                        View
                      </button>
                      {row.registration_status !== 'approved' ? (
                        <button
                          type="button"
                          disabled={submissionActionId === row.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateRegistrationStatus(row, 'approved');
                          }}
                        >
                          Approve
                        </button>
                      ) : null}
                      {row.registration_status !== 'rejected' ? (
                        <button
                          type="button"
                          className={styles.btnDangerOutline}
                          disabled={submissionActionId === row.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateRegistrationStatus(row, 'rejected');
                          }}
                        >
                          Reject
                        </button>
                      ) : null}
                      {isMatchPoolEligible(row.attendee_type) ? (
                        row.matching_opt_in ? (
                          <button
                            type="button"
                            className={styles.btnDangerOutline}
                            disabled={submissionActionId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void updateMatchingOptIn(row, false);
                            }}
                          >
                            Opt out
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={submissionActionId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void updateMatchingOptIn(row, true);
                            }}
                          >
                            Opt in
                          </button>
                        )
                      ) : null}
                      {row.email ? (
                        <button
                          type="button"
                          disabled={submissionActionId === row.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void resendRegistrationEmail(row);
                          }}
                        >
                          Resend email
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.btnDangerOutline}
                        disabled={deletingSubmissionId === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteSubmission(row);
                        }}
                      >
                        {deletingSubmissionId === row.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selectedSubmission ? (
          <div ref={submissionReviewRef} className={styles.submissionReviewPanel}>
            <div className={styles.submissionReviewHead}>
              <div>
                <h3>
                  {[selectedSubmission.first_name, selectedSubmission.last_name].filter(Boolean).join(' ') || 'Registrant'}
                </h3>
                <p className={styles.submissionReviewMeta}>
                  {selectedSubmission.email ?? '—'} · {selectedSubmission.company_name ?? '—'} ·{' '}
                  {titleizeAudience(selectedSubmission.attendee_type)}
                  {selectedSubmission.submitted_at
                    ? ` · Submitted ${new Date(selectedSubmission.submitted_at).toLocaleString()}`
                    : ''}
                </p>
                <div className={styles.submissionReviewBadges}>
                  <StatusBadge label={selectedSubmission.status} tone={formStatusTone(selectedSubmission.status)} />
                  <StatusBadge
                    label={selectedSubmission.registration_status ?? 'pending_review'}
                    tone={registrationReviewTone(selectedSubmission.registration_status)}
                  />
                  <StatusBadge
                    label={selectedSubmission.profile_complete ? 'Profile complete' : 'Profile incomplete'}
                    tone={selectedSubmission.profile_complete ? 'success' : 'muted'}
                  />
                  {isMatchPoolEligible(selectedSubmission.attendee_type) ? (
                    <StatusBadge
                      label={selectedSubmission.matching_opt_in ? 'Matching opted in' : 'Matching opted out'}
                      tone={selectedSubmission.matching_opt_in ? 'success' : 'muted'}
                    />
                  ) : null}
                </div>
              </div>
              <div className={styles.submissionReviewActions}>
                {selectedSubmission.registration_status !== 'approved' ? (
                  <button
                    type="button"
                    disabled={submissionActionId === selectedSubmission.id}
                    onClick={() => void updateRegistrationStatus(selectedSubmission, 'approved')}
                  >
                    Approve
                  </button>
                ) : null}
                {selectedSubmission.registration_status !== 'rejected' ? (
                  <button
                    type="button"
                    className={styles.btnDangerOutline}
                    disabled={submissionActionId === selectedSubmission.id}
                    onClick={() => void updateRegistrationStatus(selectedSubmission, 'rejected')}
                  >
                    Reject
                  </button>
                ) : null}
                {selectedSubmission.email ? (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    disabled={submissionActionId === selectedSubmission.id}
                    onClick={() => void resendRegistrationEmail(selectedSubmission)}
                  >
                    Resend email
                  </button>
                ) : null}
                <button type="button" className={styles.btnSecondary} onClick={() => goToTab('matching')}>
                  Open matching &amp; approve
                </button>
              </div>
            </div>
            <div className={styles.submissionReviewBody}>
              <section className={styles.submissionReviewSection}>
                <h4>Identity</h4>
                <div className={styles.submissionReviewGrid}>
                  <div className={styles.submissionReviewField}>
                    <span className={styles.submissionReviewFieldLabel}>First name</span>
                    <span className={styles.submissionReviewFieldValue}>{selectedSubmission.first_name ?? '—'}</span>
                  </div>
                  <div className={styles.submissionReviewField}>
                    <span className={styles.submissionReviewFieldLabel}>Last name</span>
                    <span className={styles.submissionReviewFieldValue}>{selectedSubmission.last_name ?? '—'}</span>
                  </div>
                  <div className={styles.submissionReviewField}>
                    <span className={styles.submissionReviewFieldLabel}>Email</span>
                    <span className={styles.submissionReviewFieldValue}>{selectedSubmission.email ?? '—'}</span>
                  </div>
                  <div className={styles.submissionReviewField}>
                    <span className={styles.submissionReviewFieldLabel}>Company</span>
                    <span className={styles.submissionReviewFieldValue}>{selectedSubmission.company_name ?? '—'}</span>
                  </div>
                  <div className={styles.submissionReviewField}>
                    <span className={styles.submissionReviewFieldLabel}>Job title</span>
                    <span className={styles.submissionReviewFieldValue}>{selectedSubmission.job_title ?? '—'}</span>
                  </div>
                </div>
              </section>
              {selectedSubmissionReviewSections.map((section) => (
                <section key={section.label} className={styles.submissionReviewSection}>
                  <h4>{section.label}</h4>
                  <div className={styles.submissionReviewGrid}>
                    {section.items.map((item) => (
                      <div
                        key={item.question.id}
                        className={`${styles.submissionReviewField} ${item.isImage ? styles.submissionReviewFieldWide : ''}`}
                      >
                        <span className={styles.submissionReviewFieldLabel}>{item.question.prompt}</span>
                        {item.isImage ? (
                          <div className={styles.submissionReviewMedia}>
                            <a
                              href={item.displayValue}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.submissionReviewLink}
                            >
                              View uploaded image
                            </a>
                            <img src={item.displayValue} alt="" className={styles.submissionReviewImage} />
                          </div>
                        ) : item.isFile ? (
                          <a
                            href={item.displayValue}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.submissionReviewLink}
                          >
                            View uploaded file
                          </a>
                        ) : item.displayValue ? (
                          <span className={styles.submissionReviewFieldValue}>{item.displayValue}</span>
                        ) : (
                          <span className={styles.submissionReviewFieldValueMuted}>—</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {selectedSubmissionReviewSections.length === 0 ? (
                <p className={styles.hint}>No additional form answers were saved with this submission.</p>
              ) : null}
              <section className={styles.submissionReviewSection}>
                <h4>Portal meeting requests</h4>
                {selectedSubmissionRequests.length === 0 ? (
                  <p className={styles.hint}>No meeting requests submitted yet.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Target</th>
                          <th>Interest</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSubmissionRequests.map((req, index) => (
                          <tr key={req.id}>
                            <td>{index + 1}</td>
                            <td>
                              {req.target_company_name || '—'}
                              {req.target_person_name ? ` · ${req.target_person_name}` : ''}
                            </td>
                            <td>{interestLevelLabel(req.interest_level)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className={styles.hint}>
                  Open{' '}
                  <button type="button" className={styles.tabLink} onClick={() => goToTab('matching')}>
                    Matching &amp; approve
                  </button>{' '}
                  to compare these with intelligent match suggestions.
                </p>
              </section>
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {activeTab === 'matching' ? (
      <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Review a participant</h2>
          {selectedSubmission ? (
            <StatusBadge label={submissionDisplayName(selectedSubmission)} tone="info" />
          ) : null}
        </div>

        <div className={styles.matchingToolbar}>
          <label className={styles.field}>
            <span>Delegate or vendor</span>
            <select
              value={selectedSubmissionId}
              onChange={(e) => setSelectedSubmissionId(e.target.value)}
            >
              <option value="">Select someone to review…</option>
              {matchPoolSubmissions.map((row) => (
                <option key={row.id} value={row.id}>
                  {submissionDisplayName(row)} · {row.company_name ?? '—'} · {titleizeAudience(row.attendee_type)}
                </option>
              ))}
            </select>
          </label>
          {selectedSubmission ? (
            <button type="button" className={styles.btnSecondary} onClick={() => goToTab('registrations')}>
              View full registration
            </button>
          ) : null}
        </div>

        {!selectedSubmission ? (
          <div className={styles.emptyState}>
            <strong>Choose a participant above</strong>
            <p>
              Or pick someone from the{' '}
              <button type="button" className={styles.tabLink} onClick={() => goToTab('registrations')}>
                Registrations
              </button>{' '}
              tab — their portal meeting requests and intelligent match suggestions will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.participantSummaryCard}>
              <div className={styles.participantSummaryMain}>
                <h3>{submissionDisplayName(selectedSubmission)}</h3>
                <p className={styles.hint}>
                  {selectedSubmission.company_name ?? '—'} · {titleizeAudience(selectedSubmission.attendee_type)} ·{' '}
                  {selectedSubmission.email ?? '—'}
                </p>
                <div className={styles.participantSummaryBadges}>
                  <StatusBadge label={selectedSubmission.status} tone={formStatusTone(selectedSubmission.status)} />
                  <StatusBadge
                    label={selectedSubmission.registration_status ?? 'pending_review'}
                    tone={registrationReviewTone(selectedSubmission.registration_status)}
                  />
                  <StatusBadge
                    label={selectedSubmission.profile_complete ? 'Profile complete' : 'Profile incomplete'}
                    tone={selectedSubmission.profile_complete ? 'success' : 'muted'}
                  />
                  {isMatchPoolEligible(selectedSubmission.attendee_type) ? (
                    <StatusBadge
                      label={selectedSubmission.matching_opt_in ? 'Matching opted in' : 'Matching opted out'}
                      tone={selectedSubmission.matching_opt_in ? 'success' : 'muted'}
                    />
                  ) : null}
                </div>
              </div>
              <div className={styles.participantSummaryActions}>
                {isMatchPoolEligible(selectedSubmission.attendee_type) ? (
                  selectedSubmission.matching_opt_in ? (
                    <button
                      type="button"
                      className={styles.btnDangerOutline}
                      disabled={submissionActionId === selectedSubmission.id}
                      onClick={() => void updateMatchingOptIn(selectedSubmission, false)}
                    >
                      Opt out of matching
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={submissionActionId === selectedSubmission.id}
                      onClick={() => void updateMatchingOptIn(selectedSubmission, true)}
                    >
                      Opt in to matching
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  className={styles.btnDangerOutline}
                  disabled={deletingSubmissionId === selectedSubmission.id}
                  onClick={() => void deleteSubmission(selectedSubmission)}
                >
                  {deletingSubmissionId === selectedSubmission.id ? 'Deleting…' : 'Delete registration'}
                </button>
              </div>
            </div>

            {selectedSubmission.registration_status !== 'approved' ? (
              <div className={styles.calloutInfo}>
                <strong>Registration not approved yet</strong>
                <p>Approve this registrant on the Registrations tab before they can send meeting requests in the portal.</p>
              </div>
            ) : null}

            {isMatchPoolEligible(selectedSubmission.attendee_type) && !selectedSubmission.matching_opt_in ? (
              <div className={styles.calloutWarning}>
                <strong>Opted out of matching</strong>
                <p>
                  This participant is excluded from the match pool. Opt them in above to include them in intelligent
                  suggestions and bulk generation.
                </p>
              </div>
            ) : null}

            <div className={styles.matchWorkflow}>
              <div className={styles.matchWorkflowStep}>
                <span className={styles.matchWorkflowNumber}>1</span>
                <span>See what they ranked in the portal</span>
              </div>
              <div className={styles.matchWorkflowStep}>
                <span className={styles.matchWorkflowNumber}>2</span>
                <span>Compare with intelligent match suggestions</span>
              </div>
              <div className={styles.matchWorkflowStep}>
                <span className={styles.matchWorkflowNumber}>3</span>
                <span>Approve pairings, then schedule 1:1 meetings</span>
              </div>
            </div>

            <div className={styles.matchCompareGrid}>
              <div className={styles.matchCompareCard}>
                <div className={styles.matchCompareCardHead}>
                  <span className={styles.matchCompareStep}>A</span>
                  <div>
                    <h3>Their meeting requests</h3>
                    <p>What this person chose in connect — ranked priority and interest (Low / Medium / High).</p>
                  </div>
                </div>
                {selectedSubmissionRequests.length === 0 ? (
                  <div className={styles.matchCompareEmpty}>
                    <strong>No requests yet</strong>
                    <p>
                      They have not ranked anyone in the connect portal. Only intelligent suggestions will appear until
                      they use Meeting Requests.
                    </p>
                  </div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Target</th>
                          <th>Interest</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSubmissionRequests.map((req, index) => (
                          <tr key={req.id}>
                            <td>{index + 1}</td>
                            <td>
                              {req.target_company_name || '—'}
                              {req.target_person_name ? ` · ${req.target_person_name}` : ''}
                            </td>
                            <td>{interestLevelLabel(req.interest_level)}</td>
                            <td>{req.reason ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {requestedNotInTopScores.length > 0 ? (
                  <p className={styles.hint}>
                    {requestedNotInTopScores.length} requested target{requestedNotInTopScores.length === 1 ? '' : 's'}{' '}
                    did not appear in the top suggestions — review them in the queue below.
                  </p>
                ) : null}
              </div>

              <div className={styles.matchCompareCard}>
                <div className={styles.matchCompareCardHead}>
                  <span className={styles.matchCompareStep}>B</span>
                  <div>
                    <h3>Intelligent match suggestions</h3>
                    <p>Category overlap, profile signals, and request priority combined into one score.</p>
                  </div>
                </div>
                {loadingSuggestions ? (
                  <p className={styles.hint}>Computing match scores…</p>
                ) : suggestedMatches.length === 0 ? (
                  <div className={styles.matchCompareEmpty}>
                    <strong>No suggestions yet</strong>
                    <p>Ensure profiles are complete, categories are selected, and the participant is opted in to matching.</p>
                  </div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Company</th>
                          <th>Score</th>
                          <th>Categories</th>
                          <th>Also requested?</th>
                          <th>Your decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestedMatches.map((item) => (
                          <tr key={item.candidate.id}>
                            <td>{submissionDisplayName(item.candidate)}</td>
                            <td>{item.candidate.company_name ?? '—'}</td>
                            <td>{item.score}</td>
                            <td>{item.overlap}</td>
                            <td>
                              {item.meetingRequest ? (
                                <span>
                                  Rank {item.requestRank ?? '—'} · {interestLevelLabel(item.meetingRequest.interest_level)}
                                </span>
                              ) : (
                                <span className={styles.hint}>Not requested</span>
                              )}
                            </td>
                            <td>
                              <div className={styles.actionRow}>
                                {item.review?.status === 'approved' ? (
                                  <>
                                    <StatusBadge label="Approved" tone="success" />
                                    <button type="button" className={styles.btnSecondary} onClick={() => goToTab('schedule')}>
                                      Schedule →
                                    </button>
                                  </>
                                ) : item.review?.status === 'rejected' ? (
                                  <StatusBadge label="Rejected" tone="danger" />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void setReviewStatus(item.candidate.id, item.score, 'approved')}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.btnDangerOutline}
                                      onClick={() => void setReviewStatus(item.candidate.id, item.score, 'rejected')}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <details className={styles.profileDetails}>
              <summary>View registration answers</summary>
              {selectedSubmissionReviewSections.length === 0 ? (
                <p className={styles.hint}>No additional form answers were saved with this submission.</p>
              ) : (
                selectedSubmissionReviewSections.map((section) => (
                  <section key={section.label} className={styles.submissionReviewSection}>
                    <h4>{section.label}</h4>
                    <div className={styles.submissionReviewGrid}>
                      {section.items.map((item) => (
                        <div key={item.question.id} className={styles.submissionReviewField}>
                          <span className={styles.submissionReviewFieldLabel}>{item.question.prompt}</span>
                          {item.displayValue ? (
                            <span className={styles.submissionReviewFieldValue}>{item.displayValue}</span>
                          ) : (
                            <span className={styles.submissionReviewFieldValueMuted}>—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </details>
          </>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>All pairing decisions</h2>
          <StatusBadge label={`${reviews.length} total · ${approvedReviews.length} approved`} tone="info" />
        </div>
        <div className={styles.toolbar}>
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void generateMatchSuggestions()}
              disabled={generatingSuggestions}
            >
              {generatingSuggestions ? 'Generating…' : 'Generate match suggestions'}
            </button>
            {approvedReviews.length > 0 ? (
              <button type="button" className={styles.btnSecondary} onClick={() => goToTab('schedule')}>
                Go to Schedule ({approvedReviews.length} approved)
              </button>
            ) : null}
          </div>
        </div>
        <p className={styles.sectionLead}>
          Event-wide queue combining portal request boosts with intelligent scoring. Approve pairings here or per
          participant above — approved matches move to the Schedule tab for 1:1 booking.
        </p>
        {reviews.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No pairing decisions yet</strong>
            <p>Review a participant above or generate suggestions for the whole event.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Score</th>
                  <th>Portal request</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const from = submissions.find((s) => s.id === r.from_submission_id);
                  const to = submissions.find((s) => s.id === r.to_submission_id);
                  const portalRequest = meetingRequestByPair.get(`${r.from_submission_id}:${r.to_submission_id}`);
                  const requestRank =
                    portalRequest && from
                      ? (() => {
                          const idx = meetingRequests
                            .filter((req) => req.submission_id === from.id)
                            .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
                            .findIndex((req) => req.id === portalRequest.id);
                          return idx >= 0 ? idx + 1 : null;
                        })()
                      : null;
                  const isScheduled = scheduledReviewIds.has(r.id);
                  return (
                    <tr key={r.id}>
                      <td>{from ? submissionDisplayName(from) : '—'}</td>
                      <td>{to ? submissionDisplayName(to) : '—'}</td>
                      <td>{r.score}</td>
                      <td>
                        {portalRequest ? (
                          <span>
                            Rank {requestRank ?? '—'} · {interestLevelLabel(portalRequest.interest_level)}
                          </span>
                        ) : (
                          <span className={styles.hint}>Not requested</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge label={isScheduled ? 'scheduled' : r.status} tone={isScheduled ? 'info' : matchReviewTone(r.status)} />
                      </td>
                      <td>
                        <div className={styles.actionRow}>
                          {r.status === 'approved' ? (
                            isScheduled ? (
                              <span className={styles.hint}>On schedule</span>
                            ) : (
                              <button type="button" onClick={() => goToTab('schedule')}>
                                Schedule →
                              </button>
                            )
                          ) : r.status === 'rejected' ? (
                            <button
                              type="button"
                              onClick={() =>
                                void updateMatchReviewStatus(r.from_submission_id, r.to_submission_id, r.score, 'approved')
                              }
                            >
                              Approve
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void updateMatchReviewStatus(r.from_submission_id, r.to_submission_id, r.score, 'approved')
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className={styles.btnDangerOutline}
                                onClick={() =>
                                  void updateMatchReviewStatus(r.from_submission_id, r.to_submission_id, r.score, 'rejected')
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${styles.section} ${styles.sectionAdvanced}`}>
        <button
          type="button"
          className={styles.advancedToggle}
          aria-expanded={scoringAdvancedOpen}
          onClick={() => setScoringAdvancedOpen((open) => !open)}
        >
          {scoringAdvancedOpen ? '▾' : '▸'} Advanced — match scoring weights
        </button>
        {scoringAdvancedOpen ? (
        <div className={styles.formStack}>
        <p className={styles.sectionLead}>
          Adjust how much each signal contributes to server-side match scores. Most events can leave these at defaults.
        </p>
        <div className={styles.grid2}>
          {(
            [
              ['weight_category', 'Solution category overlap'],
              ['weight_goals', 'Goals / priorities overlap'],
              ['weight_seniority', 'Seniority (C-suite signal)'],
              ['weight_revenue', 'Revenue tier match'],
              ['weight_budget', 'Budget tier match'],
              ['weight_scope', 'Scope of responsibility match'],
              ['weight_semantic', 'Semantic (reserved for v1.1)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={styles.field}>
              <span>{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={matchConfig[key]}
                onChange={(e) =>
                  setMatchConfig((prev) => ({
                    ...prev,
                    [key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className={styles.formActions}>
          <button type="button" className={styles.btnPrimary} disabled={savingMatchConfig} onClick={() => void saveMatchConfig()}>
            {savingMatchConfig ? 'Saving…' : 'Save scoring weights'}
          </button>
        </div>
        </div>
        ) : null}
      </section>
      </>
      ) : null}

      {activeTab === 'schedule' ? (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Schedule 1:1 meetings</h2>
          <StatusBadge label={`${approvedReviews.length} approved · ${scheduledMeetings.length} scheduled`} tone="info" />
        </div>
        <p className={styles.sectionLead}>
          Approved pairings from{' '}
          <button type="button" className={styles.tabLink} onClick={() => goToTab('matching')}>
            Matching &amp; approve
          </button>{' '}
          appear here. Pick a time slot and location, then publish to the app when ready.
        </p>

        <div className={styles.toolbar}>
          <label className={styles.field}>
            <span>Meeting start</span>
            <input type="datetime-local" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Meeting end</span>
            <input type="datetime-local" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Location</span>
            <input value={scheduleLocation} onChange={(e) => setScheduleLocation(e.target.value)} placeholder="Table A1" />
          </label>
        </div>

        <h3 className={styles.subsectionTitle}>Approved pairings — ready to schedule</h3>
        {approvedReviews.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No approved pairings yet</strong>
            <p>
              Approve matches on the{' '}
              <button type="button" className={styles.tabLink} onClick={() => goToTab('matching')}>
                Matching &amp; approve
              </button>{' '}
              tab first.
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Participant A</th>
                  <th>Participant B</th>
                  <th>Match score</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedReviews.map((r) => {
                  const from = submissions.find((s) => s.id === r.from_submission_id);
                  const to = submissions.find((s) => s.id === r.to_submission_id);
                  const isScheduled = scheduledReviewIds.has(r.id);
                  return (
                    <tr key={r.id}>
                      <td>{from ? submissionDisplayName(from) : '—'}</td>
                      <td>{to ? submissionDisplayName(to) : '—'}</td>
                      <td>{r.score}</td>
                      <td>
                        <StatusBadge label={isScheduled ? 'Scheduled' : 'Awaiting slot'} tone={isScheduled ? 'success' : 'warn'} />
                      </td>
                      <td>
                        {isScheduled ? (
                          <span className={styles.hint}>See table below</span>
                        ) : (
                          <button type="button" onClick={() => void scheduleApprovedMatch(r)}>
                            Schedule with times above
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.toolbarActions} style={{ marginTop: 16 }}>
          <button type="button" className={styles.btnSecondary} onClick={exportScheduleCsv}>
            Export schedule CSV
          </button>
        </div>

        <h3 className={styles.subsectionTitle}>Scheduled meetings</h3>
        {scheduledMeetings.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>No meetings scheduled yet</strong>
            <p>Assign a time slot to an approved pairing above.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Participant A</th>
                  <th>Participant B</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Location</th>
                  <th>App</th>
                </tr>
              </thead>
              <tbody>
                {scheduledMeetings.map((m) => {
                  const a = submissions.find((s) => s.id === m.submission_a_id);
                  const b = submissions.find((s) => s.id === m.submission_b_id);
                  return (
                    <tr key={m.id}>
                      <td>{a ? submissionDisplayName(a) : '—'}</td>
                      <td>{b ? submissionDisplayName(b) : '—'}</td>
                      <td>{new Date(m.start_time).toLocaleString()}</td>
                      <td>{new Date(m.end_time).toLocaleString()}</td>
                      <td>{m.location ?? '—'}</td>
                      <td>
                        {m.published_to_app_at ? (
                          <span>Published {new Date(m.published_to_app_at).toLocaleString()}</span>
                        ) : m.status === 'scheduled' ? (
                          <button
                            type="button"
                            disabled={publishingMeetingId === m.id}
                            onClick={() => void publishMeetingToApp(m.id)}
                          >
                            {publishingMeetingId === m.id ? 'Publishing…' : 'Publish to app'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}
      </div>
    </div>
  );
}
