import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type {
  Event,
  EventMatchmakingLocation,
  EventMatchmakingTimeSlot,
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
  isRegistrationContactPrompt,
  isRegistrationIdentityLockedPrompt,
  isRegistrationQuestionHiddenByDefault,
  isStage1RegistrationQuestion,
  normalizeRegistrationPrompt,
  REGISTRATION_HEADER_FIELD_PROMPTS,
  VENDOR_ALWAYS_HIDDEN_PROMPTS,
} from '../lib/registrationDefaultVisibility';
import { filterRegistrationDetailsQuestions } from '../lib/portalRegistrationDetailsQuestions';
import {
  DELEGATE_REGISTRATION_SECTION_ORDER,
  resolveRegistrationSectionLabel,
} from '../lib/registrationSectionLabels';
import { publicPortalLoginUrl, publicRegisterUrl } from '../lib/publicPortalUrl';
import { uniqueFormSlug } from '../lib/registrationFormSlug';
import { isLegacyImportedFormName } from '../lib/legacyImportedFormName';
import { sendRegistrationSetupEmail } from '../lib/registrationSetupEmail';
import { syncRegistrationMembership } from '../lib/syncRegistrationMembership';
import {
  isProfilePhotoRegistrationPrompt,
  isUsableProfilePhotoUrl,
} from '../lib/registrationHeadshot';
import { uploadEventImage } from '../lib/uploadEventImage';
import { interestLevelLabel } from '../lib/meetingRequests';
import {
  PORTAL_BANNER_FILE_ACCEPT,
  PORTAL_BANNER_HINT,
  PORTAL_BANNER_SIZE_LABEL,
} from '../lib/portalBannerHints';
import RichTextEditor from '../components/RichTextEditor';
import { hasRichTextContent, sanitizeHtml } from '../lib/sanitizeHtml';
import { defaultHoldingBodyHtml } from '../lib/registrantPortal';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { notifyPortalFeaturesOpened } from '../lib/notifyPortalFeaturesOpened';
import MatchmakingSolutionCategories from '../components/MatchmakingSolutionCategories';
import MatchmakingScheduleSetup from '../components/MatchmakingScheduleSetup';
import MatchmakingScheduleBoard from '../components/MatchmakingScheduleBoard';
import MatchmakingVendorMatching from '../components/MatchmakingVendorMatching';
import MatchmakingScoringSetup from '../components/MatchmakingScoringSetup';
import {
  DEFAULT_AUTO_SLOT_SETTINGS,
  type AutoSlotDefaults,
} from '../lib/matchmakingAutoSchedule';
import {
  DEFAULT_MATCH_WEIGHTS,
  isMatchScoringSetupApproved,
  type MatchConfigWeights,
} from '../lib/matchScoringSetup';
import {
  LEGACY_DELEGATE_STAGE2_HIDDEN_PROMPTS,
  LEGACY_DELEGATE_CSUITE_PROMPT,
  DELEGATE_SENIORITY_OPTIONS,
  DELEGATE_SENIORITY_PROMPT,
  MEETING_GOALS_DELEGATE_OPTIONS,
  MEETING_GOALS_VENDOR_OPTIONS,
  SOLUTION_CATEGORY_INTEREST_PROMPT,
  SOLUTION_CATEGORY_VENDOR_PROMPT,
  isSolutionCategoryInterestPrompt,
  VENDOR_BUDGET_OPTIONS,
  VENDOR_REVENUE_OPTIONS,
  VENDOR_SCOPE_OPTIONS,
  VENDOR_SENIORITY_OPTIONS,
} from '../lib/specRegistrationQuestions';
import {
  addSectionToOrder,
  defaultSectionOrderForAudience,
  mergeSectionOrder,
  removeSectionFromOrder,
  renameSectionInOrder,
  reorderSectionInOrder,
} from '../lib/registrationSectionOrder';
import { openPortalViewAsSubmission } from '../lib/adminImpersonateUser';
import {
  VENDOR_COPY_FROM_DELEGATE_SECTIONS,
  DELEGATE_SECTIONS_FOR_VENDOR_TARGET,
  collectDelegateQuestionsForVendorCopy,
  describeVendorCopyPlan,
  findVendorQuestionMatch,
  nextSortOrderInSection,
} from '../lib/copyVendorSectionFromDelegate';
import { copySolutionCategoriesBetweenForms } from '../lib/copySolutionCategoriesBetweenForms';
import { conditionalParentOptions } from '../lib/registrationQuestionConditions';
import StandardRegistrationSetup from '../components/StandardRegistrationSetup';
import styles from './EventMatchmaking.module.css';

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
  { prompt: 'First Name', question_type: 'text', is_required: true, section_label: 'Registration' },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'Company Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'Cell Phone', question_type: 'text' },
  { prompt: 'Work Phone', question_type: 'text', section_label: 'Identity & contact' },
  { prompt: 'How did you hear about this event?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.hearAboutEvent },
  { prompt: 'Dietary Restrictions', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.dietaryRestrictions },
  { prompt: 'Preferred Pronouns', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.pronouns },
  { prompt: 'Headshot/Photo', question_type: 'text', is_required: true },
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
  { prompt: DELEGATE_SENIORITY_PROMPT, question_type: 'single_select', is_required: true, options: DELEGATE_SENIORITY_OPTIONS },
  { prompt: 'Name of person I report to', question_type: 'text' },
  { prompt: SOLUTION_CATEGORY_INTEREST_PROMPT, question_type: 'multi_select', is_required: true, section_label: 'Solution interest' },
  { prompt: 'Meeting Goals', question_type: 'single_select', is_required: true, options: MEETING_GOALS_DELEGATE_OPTIONS, section_label: 'Meeting preferences' },
  { prompt: 'What are you hoping to get from this event?', question_type: 'textarea', is_required: true },
  { prompt: 'I have read and accept the Terms and Conditions and Code of Conduct', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Stage 1 registration' },
];

const VENDOR_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'First Name', question_type: 'text', is_required: true, section_label: 'Registration' },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'Company Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'Cell Phone', question_type: 'text' },
  { prompt: 'Work Phone', question_type: 'text', section_label: 'Identity & contact' },
  { prompt: 'Headshot/Photo', question_type: 'text', is_required: true },
  { prompt: 'Address', question_type: 'text', section_label: 'Company information' },
  { prompt: 'City', question_type: 'text', is_required: true },
  { prompt: 'State/Province', question_type: 'text', is_required: true },
  { prompt: 'Zip Code/Postal Code', question_type: 'text' },
  { prompt: 'Country', question_type: 'text' },
  { prompt: 'Company Description', question_type: 'textarea', is_required: true, section_label: 'Solution Provider profile (app)' },
  { prompt: 'Company Logo Image', question_type: 'text', is_required: true },
  { prompt: 'Company Website', question_type: 'text', is_required: true },
  { prompt: 'Which seniority levels are you hoping to meet with?', question_type: 'multi_select', is_required: true, options: VENDOR_SENIORITY_OPTIONS, section_label: 'Target audience & ideal customer profile' },
  { prompt: "Ideal customer's revenue range", question_type: 'multi_select', is_required: true, options: VENDOR_REVENUE_OPTIONS },
  { prompt: "Budget range you're hoping your buyer has for 2026", question_type: 'multi_select', is_required: true, options: VENDOR_BUDGET_OPTIONS },
  { prompt: "Functions/scope you're targeting", question_type: 'multi_select', is_required: true, options: VENDOR_SCOPE_OPTIONS },
  { prompt: SOLUTION_CATEGORY_VENDOR_PROMPT, question_type: 'multi_select', is_required: true, section_label: 'Solution interest (vendor)' },
  { prompt: 'Meeting Goals', question_type: 'single_select', is_required: true, options: MEETING_GOALS_VENDOR_OPTIONS, section_label: 'Meeting preferences' },
  { prompt: 'What are you hoping to accomplish at this event?', question_type: 'textarea', is_required: true },
  { prompt: 'Are you sending representatives to the event onsite?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Logistics' },
  { prompt: 'Will your team take meetings virtually?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'I have read and accept the Terms and Conditions and Code of Conduct', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Stage 1 registration' },
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
  { prompt: 'Total number of employees globally', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.employeeCount, section_label: 'Attendee eligibility questionnaire' },
  { prompt: 'Does your organization provide a tuition assistance benefit?', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'About your organization' },
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
  const custom = (form.name ?? '').trim();
  if (custom && custom !== KBM_ATTENDEE_FORM_NAME && custom !== KBM_VENDOR_FORM_NAME) {
    return custom;
  }
  if (form.audience === 'attendee') return 'Delegate Registration';
  if (form.audience === 'vendor') return 'Vendor Registration';
  if (form.audience === 'user') return 'Speaker Registration';
  return custom || 'Registration';
}

/** All non-legacy forms for admin management (supports multiple tracks per audience).
 * Speaker (`user`) forms are hidden — product only uses delegate + vendor. */
function listManageableForms(inputForms: EventRegistrationForm[]) {
  return [...inputForms]
    .filter((f) => !isLegacyImportedFormName(f.name) && f.audience !== 'user' && f.is_active !== false)
    .sort((a, b) => {
      const aud = a.audience.localeCompare(b.audience);
      if (aud !== 0) return aud;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name);
    });
}

/** Seed a new form with the same default questions as Install defaults (Stage 1 + matching fields). */
async function insertTemplateQuestionsForForm(
  formId: string,
  audience: MatchmakingAudience,
  templateQuestions: TemplateQuestion[],
  options?: { keepAll?: boolean },
): Promise<{
  questions: EventRegistrationQuestion[];
  options: EventRegistrationQuestionOption[];
}> {
  const createdQuestions: EventRegistrationQuestion[] = [];
  const createdOptions: EventRegistrationQuestionOption[] = [];
  let rollingSectionHeading: string | null = null;
  for (const [idx, q] of templateQuestions.entries()) {
    if (q.section_label?.trim()) {
      rollingSectionHeading = q.section_label.trim();
    }
    const keepForStage1 = isStage1RegistrationQuestion(audience, q.prompt);
    const hiddenByDefault = isRegistrationQuestionHiddenByDefault(audience, q.prompt);
    if (!options?.keepAll && hiddenByDefault && !keepForStage1) continue;
    const sectionForDb = sectionLabelForDatabase(rollingSectionHeading);
    const { data: insertedQuestion, error: questionInsertErr } = await supabase
      .from('event_registration_questions')
      .insert({
        form_id: formId,
        prompt: q.prompt,
        question_type: q.question_type,
        is_required: q.is_required ?? false,
        section_label: sectionForDb,
        is_base_question: true,
        is_hidden: false,
        sort_order: idx,
      })
      .select('*')
      .single();
    if (questionInsertErr) throw questionInsertErr;
    const createdQ = insertedQuestion as EventRegistrationQuestion;
    createdQuestions.push(createdQ);
    if (q.options && q.options.length > 0) {
      const optionRows = q.options.map((value, optionIdx) => ({
        question_id: createdQ.id,
        label: value,
        value,
        sort_order: optionIdx,
      }));
      const { data: newOpts, error: optionsErr } = await supabase
        .from('event_registration_question_options')
        .insert(optionRows)
        .select('*');
      if (optionsErr) throw optionsErr;
      createdOptions.push(...((newOpts as EventRegistrationQuestionOption[]) ?? []));
    }
  }
  return { questions: createdQuestions, options: createdOptions };
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
  if (/^meeting preferences(?:\s*&\s*matching)?$/i.test(label)) {
    return 'Meeting preferences';
  }
  if (/^profile(?:\s*&\s*event logistics)?$/i.test(label)) {
    return 'Identity & contact';
  }
  return label;
}

/** Stored section_label for DB: null means uncategorized / General in UI */
function sectionLabelForDatabase(rollingHeading: string | null): string | null {
  if (!rollingHeading?.trim()) return null;
  const canon = canonicalSectionLabel(rollingHeading.trim());
  return canon === 'General' ? null : canon;
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

function sectionMapForAudience(audience: MatchmakingAudience) {
  if (audience === 'vendor') return VENDOR_PROMPT_SECTION_MAP;
  if (audience === 'user') return SPEAKER_PROMPT_SECTION_MAP;
  return ATTENDEE_PROMPT_SECTION_MAP;
}

function questionMatchesSectionHeading(
  q: EventRegistrationQuestion,
  uiHeading: string,
  audience: MatchmakingAudience,
): boolean {
  return resolveRegistrationSectionLabel(q, audience) === canonicalSectionLabel(uiHeading);
}

function isSolutionInterestSection(
  sectionLabel: string,
  items: EventRegistrationQuestion[],
): boolean {
  const norm = sectionLabel.trim().toLowerCase();
  if (norm === 'solution interest' || norm.startsWith('solution interest')) return true;
  return items.some((q) => isSolutionCategoryInterestPrompt(q.prompt));
}

async function normalizeLegacyFormNames(inputForms: EventRegistrationForm[]) {
  let outputForms = [...inputForms];
  for (const form of inputForms) {
    if (!isLegacyImportedFormName(form.name)) continue;
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

type MatchmakingTab = 'website' | 'portal' | 'forms' | 'registrations' | 'profiles' | 'slots' | 'matching' | 'schedule';

/** Standard registration (no matchmaking): website, one form, and the registrations list. */
const STANDARD_TABS: { id: MatchmakingTab; label: string }[] = [
  { id: 'website', label: 'Website & registration' },
  { id: 'forms', label: 'Form' },
  { id: 'registrations', label: 'Registrations' },
];

const STANDARD_FORM_NAME = 'Event Registration';

const STANDARD_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'First Name', question_type: 'text', is_required: true, section_label: 'Registration' },
  { prompt: 'Last Name', question_type: 'text', is_required: true },
  { prompt: 'E-Mail Address', question_type: 'email', is_required: true },
  { prompt: 'Company Name', question_type: 'text', is_required: true },
  { prompt: 'Job Title', question_type: 'text', is_required: true },
  { prompt: 'Cell Phone', question_type: 'text' },
  { prompt: 'Dietary Restrictions', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.dietaryRestrictions, section_label: 'About you' },
  { prompt: 'How did you hear about this event?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.hearAboutEvent },
];

const MATCHMAKING_TABS: { id: MatchmakingTab; label: string }[] = [
  { id: 'portal', label: 'Portal setup' },
  { id: 'forms', label: 'Forms & questions' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'profiles', label: 'Profile visibility' },
  { id: 'slots', label: 'Slots & locations' },
  { id: 'matching', label: 'Approve and schedule' },
  { id: 'schedule', label: 'Review and publish' },
];

function parseMatchmakingTab(raw: string | undefined): MatchmakingTab | null {
  if (
    raw === 'website' ||
    raw === 'portal' ||
    raw === 'forms' ||
    raw === 'registrations' ||
    raw === 'profiles' ||
    raw === 'slots' ||
    raw === 'matching' ||
    raw === 'schedule'
  ) {
    return raw;
  }
  return null;
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

type LogisticsRepresentative = {
  firstName?: string;
  lastName?: string;
  title?: string;
  workPhone?: string;
  cell?: string;
  email?: string;
};

type LogisticsAnswerPayload = {
  onsite?: string | null;
  virtual?: string | null;
  representatives?: LogisticsRepresentative[];
};

const LOGISTICS_ATTENDING_PROMPT = 'Are you sending representatives to the event onsite?';
const LOGISTICS_VIRTUAL_PROMPT = 'Will your team take meetings virtually?';

function parseLogisticsAnswerJson(value: unknown): LogisticsAnswerPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!('onsite' in obj) && !('representatives' in obj)) return null;
  return {
    onsite: obj.onsite != null ? String(obj.onsite) : null,
    virtual: obj.virtual != null && obj.virtual !== '' ? String(obj.virtual) : null,
    representatives: Array.isArray(obj.representatives)
      ? (obj.representatives as LogisticsRepresentative[])
      : [],
  };
}

function LogisticsAnswerDisplay({ payload }: { payload: LogisticsAnswerPayload }) {
  const reps = (payload.representatives ?? []).filter(
    (r) =>
      (r.firstName ?? '').trim() ||
      (r.lastName ?? '').trim() ||
      (r.title ?? '').trim() ||
      (r.email ?? '').trim() ||
      (r.workPhone ?? '').trim() ||
      (r.cell ?? '').trim(),
  );
  return (
    <div className={styles.logisticsAnswerBlock}>
      <div className={styles.logisticsSummaryRow}>
        <span className={styles.logisticsSummaryItem}>
          <strong>Onsite</strong> {payload.onsite?.trim() || '—'}
        </span>
        {payload.virtual ? (
          <span className={styles.logisticsSummaryItem}>
            <strong>Virtual meetings</strong> {payload.virtual}
          </span>
        ) : null}
      </div>
      {reps.length > 0 ? (
        <div className={styles.logisticsRepsList}>
          <span className={styles.submissionReviewFieldLabel}>Representatives</span>
          {reps.map((rep, idx) => {
            const name = [rep.firstName, rep.lastName].filter(Boolean).join(' ').trim() || `Representative ${idx + 1}`;
            return (
              <div key={`${name}-${idx}`} className={styles.logisticsRepCard}>
                <div className={styles.logisticsRepName}>{name}</div>
                {rep.title?.trim() ? <div className={styles.logisticsRepMeta}>{rep.title.trim()}</div> : null}
                {rep.email?.trim() ? (
                  <div className={styles.logisticsRepMeta}>Email: {rep.email.trim()}</div>
                ) : null}
                {rep.workPhone?.trim() ? (
                  <div className={styles.logisticsRepMeta}>Work: {rep.workPhone.trim()}</div>
                ) : null}
                {rep.cell?.trim() ? (
                  <div className={styles.logisticsRepMeta}>Cell: {rep.cell.trim()}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : payload.onsite?.trim().toLowerCase() === 'yes' ? (
        <p className={styles.submissionReviewFieldValueMuted}>No representative details provided.</p>
      ) : null}
    </div>
  );
}

function formatRegistrationAnswerDisplay(ans: EventRegistrationAnswer): string {
  if (Array.isArray(ans.answer_json)) {
    return (ans.answer_json as string[]).filter(Boolean).join('\n');
  }
  if (ans.answer_json != null && typeof ans.answer_json === 'object') {
    const logistics = parseLogisticsAnswerJson(ans.answer_json);
    if (logistics) {
      const lines: string[] = [];
      if (logistics.onsite) lines.push(`Onsite: ${logistics.onsite}`);
      if (logistics.virtual) lines.push(`Virtual meetings: ${logistics.virtual}`);
      for (const rep of logistics.representatives ?? []) {
        const name = [rep.firstName, rep.lastName].filter(Boolean).join(' ').trim();
        if (name) lines.push(name);
        if (rep.title?.trim()) lines.push(`  ${rep.title.trim()}`);
        if (rep.email?.trim()) lines.push(`  Email: ${rep.email.trim()}`);
      }
      return lines.join('\n');
    }
    return JSON.stringify(ans.answer_json);
  }
  if (ans.answer_json != null) return String(ans.answer_json);
  if (ans.answer_text != null) return ans.answer_text;
  if (ans.answer_number != null) return String(ans.answer_number);
  if (ans.answer_boolean != null) return ans.answer_boolean ? 'Yes' : 'No';
  return '';
}

function answerTextForPrompt(
  formQuestions: EventRegistrationQuestion[],
  answers: EventRegistrationAnswer[],
  prompt: string,
): string {
  const target = prompt.trim().toLowerCase();
  const question = formQuestions.find((q) => q.prompt.trim().toLowerCase() === target);
  if (!question) return '';
  const ans = answers.find((a) => a.question_id === question.id);
  return ans ? formatRegistrationAnswerDisplay(ans) : '';
}

function isCompanyLogoPrompt(prompt: string): boolean {
  const norm = prompt.trim().toLowerCase();
  return norm === 'company logo url' || norm === 'company logo image';
}

function isImageAnswerValue(value: string, prompt?: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  // Headshot / logo fields: treat any http(s) image URL as an image (including CDN/R2 without extension).
  if (prompt && (isProfilePhotoRegistrationPrompt(prompt) || isCompanyLogoPrompt(prompt))) {
    if (isUsableProfilePhotoUrl(v)) return true;
    return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(v) || v.includes('/event-photos/') || v.includes('/storage/');
  }
  return (
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(v) ||
    v.includes('/storage/v1/object/public/') ||
    v.includes('/registration-headshots/') ||
    v.includes('/vendor-logos/') ||
    v.includes('/event-photos/')
  );
}

function isFileAnswerValue(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) || v.startsWith('data:');
}

export default function EventMatchmaking({ mode = 'matchmaking' }: { mode?: 'matchmaking' | 'standard' }) {
  const { eventId, tab: tabParam } = useParams<{ eventId: string; tab?: string }>();
  const navigate = useNavigate();
  const submissionReviewRef = useRef<HTMLDivElement | null>(null);
  const isStandard = mode === 'standard';
  const tabList = isStandard ? STANDARD_TABS : MATCHMAKING_TABS;
  const routeBase = isStandard ? 'standard-registration' : 'matchmaking';
  const defaultTab: MatchmakingTab = isStandard ? 'website' : 'portal';
  const parsedTab = parseMatchmakingTab(tabParam);
  const activeTab: MatchmakingTab =
    parsedTab && tabList.some((t) => t.id === parsedTab) ? parsedTab : defaultTab;
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
  const [selectedSubmissionAvatarUrl, setSelectedSubmissionAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [meetingRequestsOpen, setMeetingRequestsOpen] = useState(false);
  const [vendorMatchSuggestionsEnabled, setVendorMatchSuggestionsEnabled] = useState(false);
  const [delegateMatchSuggestionsEnabled, setDelegateMatchSuggestionsEnabled] = useState(false);
  const [portalReceivedRequestsVisible, setPortalReceivedRequestsVisible] = useState(false);
  const [delegateHotelVisible, setDelegateHotelVisible] = useState(true);
  const [delegateHotelContent, setDelegateHotelContent] = useState('');
  const [registrationNotifyTeamEmails, setRegistrationNotifyTeamEmails] = useState('');
  const [registrationFromEmail, setRegistrationFromEmail] = useState('');
  const [delegateStage2Active, setDelegateStage2Active] = useState(false);
  const [vendorStage2Active, setVendorStage2Active] = useState(false);
  const [registrationFlowMode, setRegistrationFlowMode] = useState<'one_step' | 'two_step'>('two_step');
  const [stage2HoldingMessage, setStage2HoldingMessage] = useState(defaultHoldingBodyHtml);
  const [stage2ExpectedOpenAt, setStage2ExpectedOpenAt] = useState('');
  const [savingPortalSettings, setSavingPortalSettings] = useState(false);
  const [portalSaveNote, setPortalSaveNote] = useState('');
  /** Last saved activation flags — used to detect newly turned-on features that should email users. */
  const [savedActivationFlags, setSavedActivationFlags] = useState({
    delegateStage2: false,
    vendorStage2: false,
    meetingRequests: false,
  });
  const [activationConfirm, setActivationConfirm] = useState<{
    parts: string[];
    recipientCount: number;
    sendEmail: boolean;
    activatingDelegateStage2: boolean;
    activatingVendorStage2: boolean;
    activatingMeetingRequests: boolean;
  } | null>(null);
  const [uploadingPortalBanner, setUploadingPortalBanner] = useState(false);
  const portalBannerInputRef = useRef<HTMLInputElement>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [submissionActionId, setSubmissionActionId] = useState('');
  const [publishingMeetingId, setPublishingMeetingId] = useState('');
  const [matchConfig, setMatchConfig] = useState<MatchConfigWeights>(DEFAULT_MATCH_WEIGHTS);

  const [newFormName, setNewFormName] = useState('');
  const [newFormAudience, setNewFormAudience] = useState<MatchmakingAudience>('attendee');
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [renamingFormId, setRenamingFormId] = useState('');
  const [renameFormValue, setRenameFormValue] = useState('');
  const [duplicatingFormId, setDuplicatingFormId] = useState('');
  const [deletingFormId, setDeletingFormId] = useState('');

  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionType, setQuestionType] = useState<MatchmakingQuestionType>('text');
  const [questionRequired, setQuestionRequired] = useState(false);
  const [questionSectionLabel, setQuestionSectionLabel] = useState('');
  const [questionConditionParentId, setQuestionConditionParentId] = useState('');
  const [questionConditionValue, setQuestionConditionValue] = useState('');
  /** '' = General; '__custom__' = use questionSectionLabel */
  const [questionSectionPick, setQuestionSectionPick] = useState<string>('');
  /** Draft answer choices while adding a single/multi select question in the right panel. */
  const [draftOptionLabels, setDraftOptionLabels] = useState<string[]>([]);
  const [draftOptionInput, setDraftOptionInput] = useState('');
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
  const [duplicatingQuestionId, setDuplicatingQuestionId] = useState('');
  const [sectionBusy, setSectionBusy] = useState(false);
  const [copyingSectionLabel, setCopyingSectionLabel] = useState('');
  const [categoriesRefreshKey, setCategoriesRefreshKey] = useState(0);
  const [delegateCopySourceFormId, setDelegateCopySourceFormId] = useState('');
  const [draggingSectionLabel, setDraggingSectionLabel] = useState('');
  const [dragOverSectionLabel, setDragOverSectionLabel] = useState('');
  const [repairingSections, setRepairingSections] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [editingQuestionPrompt, setEditingQuestionPrompt] = useState('');
  const [editingQuestionType, setEditingQuestionType] = useState<MatchmakingQuestionType>('text');
  const [editingQuestionRequired, setEditingQuestionRequired] = useState(false);
  const [editingQuestionIsDefault, setEditingQuestionIsDefault] = useState(false);
  const [editingQuestionSectionLabel, setEditingQuestionSectionLabel] = useState('');
  const [editingQuestionConditionParentId, setEditingQuestionConditionParentId] = useState('');
  const [editingQuestionConditionValue, setEditingQuestionConditionValue] = useState('');
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
  const [formFilter, setFormFilter] = useState<'all' | string>('all');
  const [registrationSearch, setRegistrationSearch] = useState('');
  const [ensuringDefaults, setEnsuringDefaults] = useState(false);
  const [didInitialDefaultSync, setDidInitialDefaultSync] = useState(false);
  const [scheduleTimeSlots, setScheduleTimeSlots] = useState<EventMatchmakingTimeSlot[]>([]);
  const [scheduleLocations, setScheduleLocations] = useState<EventMatchmakingLocation[]>([]);
  const [scheduleTimeSlotId, setScheduleTimeSlotId] = useState('');
  const [scheduleLocationId, setScheduleLocationId] = useState('');
  const [scheduleActionId, setScheduleActionId] = useState('');
  const [autoSlotDefaults, setAutoSlotDefaults] = useState<AutoSlotDefaults>(DEFAULT_AUTO_SLOT_SETTINGS);
  const [matchNotice, setMatchNotice] = useState('');
  const matchNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState('');

  const showMatchNotice = useCallback((message: string) => {
    if (matchNoticeTimerRef.current) {
      clearTimeout(matchNoticeTimerRef.current);
      matchNoticeTimerRef.current = null;
    }
    setMatchNotice(message);
    if (!message) return;
    matchNoticeTimerRef.current = setTimeout(() => {
      setMatchNotice('');
      matchNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (matchNoticeTimerRef.current) clearTimeout(matchNoticeTimerRef.current);
    };
  }, []);

  const visibleForms = useMemo(
    () => listManageableForms(forms).filter((f) => (f.is_standard === true) === isStandard),
    [forms, isStandard],
  );
  const delegateFormsForCopy = useMemo(
    () => visibleForms.filter((f) => f.audience === 'attendee'),
    [visibleForms],
  );
  const activeForm = useMemo(
    () => visibleForms.find((f) => f.id === selectedFormId) ?? visibleForms[0] ?? null,
    [visibleForms, selectedFormId]
  );

  useEffect(() => {
    if (delegateFormsForCopy.length === 0) {
      setDelegateCopySourceFormId('');
      return;
    }
    setDelegateCopySourceFormId((prev) =>
      prev && delegateFormsForCopy.some((f) => f.id === prev) ? prev : delegateFormsForCopy[0]!.id,
    );
  }, [delegateFormsForCopy]);

  // Admin list always includes hidden questions so Show / Show section stay visible.
  const activeQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.form_id === activeForm?.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questions, activeForm],
  );
  const sectionContainsBaseQuestions = useCallback(
    (sectionLabel: string) => {
      const audience = activeForm?.audience ?? 'attendee';
      return questions.some(
        (q) =>
          q.form_id === activeForm?.id &&
          Boolean(q.is_base_question) &&
          questionMatchesSectionHeading(q, sectionLabel, audience),
      );
    },
    [questions, activeForm],
  );
  const hiddenQuestionCount = useMemo(
    () => questions.filter((q) => q.form_id === activeForm?.id && q.is_hidden).length,
    [questions, activeForm],
  );
  const selectedQuestion = useMemo(() => {
    const q = questions.find((item) => item.id === selectedQuestionId);
    if (!q || q.form_id !== activeForm?.id) return null;
    return q;
  }, [questions, selectedQuestionId, activeForm?.id]);
  const canEditSelectedQuestion = !selectedQuestion?.is_base_question || isPlatformAdmin;
  const selectedQuestionIdentityLocked = Boolean(
    selectedQuestion && isRegistrationIdentityLockedPrompt(selectedQuestion.prompt),
  );
  /** Prompt/type for Company Name, First Name, Email, etc. — never rename (breaks the public header grid). */
  const canEditSelectedQuestionPrompt = canEditSelectedQuestion && !selectedQuestionIdentityLocked;
  const canEditSelectedQuestionSection = canEditSelectedQuestion && !selectedQuestionIdentityLocked;
  const selectedQuestionOptions = useMemo(
    () =>
      questionOptions
        .filter((opt) => opt.question_id === selectedQuestionId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questionOptions, selectedQuestionId]
  );
  const conditionalParentQuestions = useMemo(
    () => conditionalParentOptions(activeQuestions, questionOptions, selectedQuestionId),
    [activeQuestions, questionOptions, selectedQuestionId],
  );
  const conditionChoicesFor = useCallback(
    (parentId: string): string[] => {
      const parent = activeQuestions.find((question) => question.id === parentId);
      if (!parent) return [];
      if (parent.question_type === 'boolean') return ['Yes', 'No'];
      return questionOptions
        .filter((option) => option.question_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((option) => option.value);
    },
    [activeQuestions, questionOptions],
  );
  const activeFormSectionOrder = useMemo(
    () => (activeForm ? mergeSectionOrder(activeForm, activeQuestions) : []),
    [activeForm, activeQuestions],
  );

  const activeSectionGroups = useMemo(() => {
    const groups = new Map<string, EventRegistrationQuestion[]>();
    const audience = activeForm?.audience ?? 'attendee';
    activeQuestions.forEach((q) => {
      // Prefer prompt-based section resolution so header fields always sit under Registration.
      const key = resolveRegistrationSectionLabel(q, audience);
      const list = groups.get(key) ?? [];
      list.push(q);
      groups.set(key, list);
    });
    for (const [key, list] of groups) {
      groups.set(
        key,
        [...list].sort(
          (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
        ),
      );
    }

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
    () => activeSectionGroups.map((g) => g.label),
    [activeSectionGroups],
  );
  const sectionFilterChoices = useMemo(
    () => activeSectionGroups.map((g) => g.label),
    [activeSectionGroups],
  );

  /** Only sections that exist on this form (order + any section already used by a question). */
  const addQuestionSectionPickOptions = useMemo(() => {
    const merged = new Set<string>();
    activeFormSectionOrder.forEach((s) => {
      const canon = canonicalSectionLabel(s);
      if (canon && canon !== 'General') merged.add(canon);
    });
    sectionChoices.forEach((s) => {
      const canon = canonicalSectionLabel(s);
      if (canon && canon !== 'General') merged.add(canon);
    });
    return Array.from(merged).sort((a, b) => {
      const ai = activeFormSectionOrder.indexOf(a);
      const bi = activeFormSectionOrder.indexOf(b);
      const aRank = ai >= 0 ? ai : 999;
      const bRank = bi >= 0 ? bi : 999;
      if (aRank !== bRank) return aRank - bRank;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }, [sectionChoices, activeFormSectionOrder]);
  const visibleSectionGroups = useMemo(
    () => (sectionFilterLabel === 'all' ? activeSectionGroups : activeSectionGroups.filter((group) => group.label === sectionFilterLabel)),
    [activeSectionGroups, sectionFilterLabel]
  );
  const questionSearchNorm = questionSearchQuery.trim().toLowerCase();
  const canReorderSections = sectionFilterLabel === 'all' && !questionSearchNorm;
  const isStage1SectionLabel = (label: string) => label.trim().toLowerCase() === 'stage 1 registration';
  const canDragSection = (label: string) =>
    canReorderSections && label !== 'General' && !isStage1SectionLabel(label);
  const canDropOnSection = (label: string) =>
    canReorderSections && label !== 'General' && !isStage1SectionLabel(label);
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
    const audience = activeForm?.audience ?? 'attendee';
    const displaySection = resolveRegistrationSectionLabel(selectedQuestion, audience);
    return (
      editingQuestionPrompt.trim() !== selectedQuestion.prompt.trim() ||
      editingQuestionType !== selectedQuestion.question_type ||
      editingQuestionRequired !== Boolean(selectedQuestion.is_required) ||
      editingQuestionIsDefault !== Boolean(selectedQuestion.is_base_question) ||
      editingQuestionConditionParentId !== (selectedQuestion.condition_question_id ?? '') ||
      editingQuestionConditionValue.trim() !== (selectedQuestion.condition_value ?? '').trim() ||
      canonicalSectionLabel(editingQuestionSectionLabel.trim() || 'General') !==
        canonicalSectionLabel(displaySection) ||
      editingQuestionUsedInMatching !== Boolean(selectedQuestion.used_in_matching)
    );
  }, [
    activeForm,
    selectedQuestion,
    editingQuestionPrompt,
    editingQuestionType,
    editingQuestionRequired,
    editingQuestionIsDefault,
    editingQuestionConditionParentId,
    editingQuestionConditionValue,
    editingQuestionSectionLabel,
    editingQuestionUsedInMatching,
  ]);

  const filteredSubmissions = useMemo(() => {
    const q = registrationSearch.trim().toLowerCase();
    return submissions
      .filter((row) => {
        // Product does not use speaker registration — hide legacy `user` rows.
        if (row.attendee_type === 'user') return false;
        if (subFilter !== 'all' && row.status !== subFilter) return false;
        if (audienceFilter !== 'all' && row.attendee_type !== audienceFilter) return false;
        if (formFilter !== 'all' && row.form_id !== formFilter) return false;
        if (q) {
          const haystack = [
            row.first_name,
            row.last_name,
            row.email,
            row.company_name,
            row.job_title,
            [row.first_name, row.last_name].filter(Boolean).join(' '),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        const aSub = a.submitted_at ? Date.parse(a.submitted_at) : 0;
        const bSub = b.submitted_at ? Date.parse(b.submitted_at) : 0;
        if (aSub !== bSub) return bSub - aSub;
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      });
  }, [submissions, subFilter, audienceFilter, formFilter, registrationSearch]);

  const formNameById = useMemo(() => {
    const map = new Map<string, string>();
    forms.forEach((f) => map.set(f.id, toDisplayFormName(f)));
    return map;
  }, [forms]);

  const registrationFormFilterOptions = useMemo(() => {
    const ids = new Set(submissions.map((s) => s.form_id).filter(Boolean));
    visibleForms.forEach((f) => ids.add(f.id));
    return [...ids]
      .map((id) => ({ id, label: formNameById.get(id) ?? 'Unknown form' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [submissions, visibleForms, formNameById]);

  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === selectedSubmissionId) ?? null,
    [submissions, selectedSubmissionId]
  );

  useEffect(() => {
    const userId = selectedSubmission?.user_id ?? null;
    if (!userId) {
      setSelectedSubmissionAvatarUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('users').select('avatar_url').eq('id', userId).maybeSingle();
      if (cancelled) return;
      const url = String((data as { avatar_url?: string | null } | null)?.avatar_url ?? '').trim();
      setSelectedSubmissionAvatarUrl(isUsableProfilePhotoUrl(url) ? url : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSubmission?.user_id]);

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
  const selectedSubmissionFormQuestions = useMemo(() => {
    if (!selectedSubmission) return [];
    const audience: MatchmakingAudience =
      selectedSubmission.attendee_type === 'vendor' ? 'vendor' : 'attendee';
    const formQuestions = questions.filter((q) => q.form_id === selectedSubmission.form_id);
    // Same question set the registrant sees on Registration Details fillout.
    return filterRegistrationDetailsQuestions(audience, formQuestions).sort(
      (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    );
  }, [selectedSubmission, questions]);

  const selectedSubmissionPhones = useMemo(() => {
    if (!selectedSubmission) return { cell: '', work: '' };
    return {
      cell: answerTextForPrompt(
        selectedSubmissionFormQuestions,
        selectedSubmissionAnswers,
        'Cell Phone',
      ),
      work: answerTextForPrompt(
        selectedSubmissionFormQuestions,
        selectedSubmissionAnswers,
        'Work Phone',
      ),
    };
  }, [selectedSubmission, selectedSubmissionFormQuestions, selectedSubmissionAnswers]);

  const selectedSubmissionReviewSections = useMemo(() => {
    if (!selectedSubmission) return [];
    const audience: MatchmakingAudience =
      selectedSubmission.attendee_type === 'vendor' ? 'vendor' : 'attendee';
    const answerByQuestionId = new Map(selectedSubmissionAnswers.map((a) => [a.question_id, a]));
    const sections = new Map<
      string,
      Array<{
        question: EventRegistrationQuestion;
        displayValue: string;
        logisticsPayload: LogisticsAnswerPayload | null;
        isImage: boolean;
        isFile: boolean;
        isWide: boolean;
      }>
    >();

    const attendingQuestion = selectedSubmissionFormQuestions.find(
      (q) => q.prompt.trim().toLowerCase() === LOGISTICS_ATTENDING_PROMPT.toLowerCase(),
    );
    const attendingAnswer = attendingQuestion
      ? answerByQuestionId.get(attendingQuestion.id) ?? null
      : null;
    const embeddedLogistics = attendingAnswer?.answer_json
      ? parseLogisticsAnswerJson(attendingAnswer.answer_json)
      : null;

    for (const q of selectedSubmissionFormQuestions) {
      const promptNorm = q.prompt.trim().toLowerCase();
      if (REGISTRATION_HEADER_FIELD_PROMPTS.has(promptNorm)) continue;
      if (promptNorm === 'work phone') continue;
      if (
        promptNorm === LOGISTICS_VIRTUAL_PROMPT.toLowerCase() &&
        embeddedLogistics &&
        embeddedLogistics.virtual != null
      ) {
        continue;
      }
      const ans = answerByQuestionId.get(q.id) ?? null;
      const logisticsPayload =
        ans?.answer_json != null ? parseLogisticsAnswerJson(ans.answer_json) : null;
      let displayValue = ans ? formatRegistrationAnswerDisplay(ans) : '';
      // Fallback to linked app profile photo when the form answer is empty.
      if (
        !displayValue &&
        isProfilePhotoRegistrationPrompt(q.prompt) &&
        selectedSubmissionAvatarUrl
      ) {
        displayValue = selectedSubmissionAvatarUrl;
      }
      // Media shown in the top strip — skip empty noise and avoid duplicating images below.
      const isHeadshot = isProfilePhotoRegistrationPrompt(q.prompt);
      const isLogo = isCompanyLogoPrompt(q.prompt);
      if ((isHeadshot || isLogo) && displayValue) continue;
      if (!displayValue.trim()) continue;
      const sectionLabel = resolveRegistrationSectionLabel(q, audience);
      if (!sections.has(sectionLabel)) sections.set(sectionLabel, []);
      const isImage = isImageAnswerValue(displayValue, q.prompt);
      const isFile = !isImage && isFileAnswerValue(displayValue);
      sections.get(sectionLabel)!.push({
        question: q,
        displayValue,
        logisticsPayload,
        isImage,
        isFile,
        isWide:
          Boolean(logisticsPayload) ||
          isImage ||
          isFile ||
          isHeadshot ||
          q.question_type === 'textarea' ||
          q.question_type === 'multi_select' ||
          displayValue.includes('\n'),
      });
    }

    const preferredOrder = [...DELEGATE_REGISTRATION_SECTION_ORDER, 'General'];
    return Array.from(sections.entries())
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => {
        const ai = preferredOrder.indexOf(a.label as (typeof preferredOrder)[number]);
        const bi = preferredOrder.indexOf(b.label as (typeof preferredOrder)[number]);
        const aRank = ai === -1 ? preferredOrder.length : ai;
        const bRank = bi === -1 ? preferredOrder.length : bi;
        if (aRank !== bRank) return aRank - bRank;
        return a.label.localeCompare(b.label);
      });
  }, [selectedSubmission, selectedSubmissionFormQuestions, selectedSubmissionAnswers, selectedSubmissionAvatarUrl]);

  const selectedSubmissionMedia = useMemo(() => {
    if (!selectedSubmission) return { headshotUrl: null as string | null, logoUrl: null as string | null };
    const answerByQuestionId = new Map(selectedSubmissionAnswers.map((a) => [a.question_id, a]));
    let headshotUrl: string | null = selectedSubmissionAvatarUrl;
    let logoUrl: string | null = null;
    for (const q of selectedSubmissionFormQuestions) {
      const ans = answerByQuestionId.get(q.id);
      const value = ans ? formatRegistrationAnswerDisplay(ans).trim() : '';
      if (!value) continue;
      if (isProfilePhotoRegistrationPrompt(q.prompt) && isImageAnswerValue(value, q.prompt)) {
        headshotUrl = value;
      }
      if (isCompanyLogoPrompt(q.prompt) && isImageAnswerValue(value, q.prompt)) {
        logoUrl = value;
      }
    }
    return { headshotUrl, logoUrl };
  }, [
    selectedSubmission,
    selectedSubmissionFormQuestions,
    selectedSubmissionAnswers,
    selectedSubmissionAvatarUrl,
  ]);

  const closeSubmissionReview = useCallback(() => {
    setSelectedSubmissionId('');
  }, []);

  const selectSubmissionForReview = useCallback((id: string) => {
    setSelectedSubmissionId(id);
  }, []);

  useEffect(() => {
    if (!selectedSubmissionId || activeTab !== 'registrations') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSubmissionReview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSubmissionId, activeTab, closeSubmissionReview]);



  const approvedReviews = useMemo(() => reviews.filter((r) => r.status === 'approved'), [reviews]);

  const scoringSetupApproved = useMemo(
    () =>
      isMatchScoringSetupApproved({
        forms,
        questions,
        currentWeights: matchConfig,
      }),
    [forms, questions, matchConfig],
  );

  const activeScheduledMeetings = useMemo(
    () => scheduledMeetings.filter((meeting) => meeting.status === 'scheduled'),
    [scheduledMeetings],
  );
  const activeScheduledReviewIds = useMemo(
    () => new Set(activeScheduledMeetings.map((meeting) => meeting.review_id).filter(Boolean) as string[]),
    [activeScheduledMeetings],
  );
  const unscheduledApprovedReviews = useMemo(() => {
    const scheduledPairs = new Set(
      activeScheduledMeetings.map((m) => {
        const a = m.submission_a_id;
        const b = m.submission_b_id;
        return a < b ? `${a}:${b}` : `${b}:${a}`;
      }),
    );
    return approvedReviews.filter((review) => {
      if (activeScheduledReviewIds.has(review.id)) return false;
      const a = review.from_submission_id;
      const b = review.to_submission_id;
      const pairKey = a < b ? `${a}:${b}` : `${b}:${a}`;
      return !scheduledPairs.has(pairKey);
    });
  }, [activeScheduledMeetings, activeScheduledReviewIds, approvedReviews]);


  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!eventId) return;
    setError('');
    if (!opts?.silent) setLoading(true);
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, start_date, end_date, portal_banner_url, badge_banner_url, banner_url, logo_url')
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      setEvent((ev as Event) ?? null);

      const [
        { data: formRows, error: formErr },
        { data: submissionRows, error: submissionErr },
        { data: settingsRow, error: settingsErr },
        { data: requestRows, error: requestErr },
        { data: reviewRows, error: reviewErr },
        { data: schedRows, error: schedErr },
        { data: matchConfigRow, error: matchConfigErr },
      ] = await Promise.all([
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
          .order('submitted_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('event_matchmaking_settings')
          .select('registration_open, meeting_requests_open, portal_match_suggestions_vendors_enabled, portal_match_suggestions_delegates_enabled, portal_received_requests_visible, delegate_portal_hotel_visible, delegate_hotel_content, registration_notify_team_emails, registration_from_email, delegate_stage2_active, vendor_stage2_active, stage2_holding_message, stage2_expected_open_at, registration_flow_mode')
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
        supabase
          .from('event_match_config')
          .select('weight_category, weight_goals, weight_seniority, weight_revenue, weight_budget, weight_scope, weight_semantic')
          .eq('event_id', eventId)
          .maybeSingle(),
      ]);

      if (formErr) throw formErr;
      if (submissionErr) throw submissionErr;
      if (settingsErr) throw settingsErr;
      if (requestErr) throw requestErr;
      if (reviewErr) throw reviewErr;
      if (schedErr) throw schedErr;
      if (matchConfigErr) throw matchConfigErr;
      setRegistrationOpen(Boolean((settingsRow as { registration_open?: boolean } | null)?.registration_open));
      const settings = settingsRow as {
        meeting_requests_open?: boolean;
        portal_match_suggestions_vendors_enabled?: boolean;
        portal_match_suggestions_delegates_enabled?: boolean;
        portal_received_requests_visible?: boolean;
        delegate_portal_hotel_visible?: boolean;
        delegate_hotel_content?: string | null;
        registration_notify_team_emails?: string | null;
        registration_from_email?: string | null;
        delegate_stage2_active?: boolean;
        vendor_stage2_active?: boolean;
        stage2_holding_message?: string | null;
        stage2_expected_open_at?: string | null;
      } | null;
      setMeetingRequestsOpen(Boolean(settings?.meeting_requests_open));
      setVendorMatchSuggestionsEnabled(Boolean(settings?.portal_match_suggestions_vendors_enabled));
      setDelegateMatchSuggestionsEnabled(Boolean(settings?.portal_match_suggestions_delegates_enabled));
      setPortalReceivedRequestsVisible(Boolean(settings?.portal_received_requests_visible));
      setDelegateHotelVisible(settings?.delegate_portal_hotel_visible !== false);
      setDelegateHotelContent(
        hasRichTextContent(settings?.delegate_hotel_content)
          ? sanitizeHtml(settings?.delegate_hotel_content ?? '')
          : ''
      );
      setRegistrationNotifyTeamEmails(settings?.registration_notify_team_emails ?? '');
      setRegistrationFromEmail(settings?.registration_from_email ?? '');
      setDelegateStage2Active(Boolean(settings?.delegate_stage2_active));
      setVendorStage2Active(Boolean(settings?.vendor_stage2_active));
      setRegistrationFlowMode(
        (settings as { registration_flow_mode?: string } | null)?.registration_flow_mode === 'one_step'
          ? 'one_step'
          : 'two_step',
      );
      setSavedActivationFlags({
        delegateStage2: Boolean(settings?.delegate_stage2_active),
        vendorStage2: Boolean(settings?.vendor_stage2_active),
        meetingRequests: Boolean(settings?.meeting_requests_open),
      });
      setStage2HoldingMessage(
        hasRichTextContent(settings?.stage2_holding_message)
          ? sanitizeHtml(settings?.stage2_holding_message ?? defaultHoldingBodyHtml())
          : defaultHoldingBodyHtml()
      );
      setStage2ExpectedOpenAt(formatDatetimeLocalValue(settings?.stage2_expected_open_at));

      if (matchConfigRow) {
        setMatchConfig({
          weight_category: matchConfigRow.weight_category ?? DEFAULT_MATCH_WEIGHTS.weight_category,
          weight_goals: matchConfigRow.weight_goals ?? DEFAULT_MATCH_WEIGHTS.weight_goals,
          weight_seniority: matchConfigRow.weight_seniority ?? DEFAULT_MATCH_WEIGHTS.weight_seniority,
          weight_revenue: matchConfigRow.weight_revenue ?? DEFAULT_MATCH_WEIGHTS.weight_revenue,
          weight_budget: matchConfigRow.weight_budget ?? DEFAULT_MATCH_WEIGHTS.weight_budget,
          weight_scope: matchConfigRow.weight_scope ?? DEFAULT_MATCH_WEIGHTS.weight_scope,
          weight_semantic: matchConfigRow.weight_semantic ?? DEFAULT_MATCH_WEIGHTS.weight_semantic,
        });
      } else {
        setMatchConfig(DEFAULT_MATCH_WEIGHTS);
      }

      const nextFormsRaw = (formRows as EventRegistrationForm[]) ?? [];
      const nextForms = (await normalizeLegacyFormNames(nextFormsRaw)).filter(
        (f) => (f.is_standard === true) === isStandard,
      );
      setForms(nextForms);
      const manageable = listManageableForms(nextForms);
      const firstFormId = manageable[0]?.id ?? '';
      setSelectedFormId((current) => {
        if (!current && firstFormId) return firstFormId;
        if (current && !manageable.some((f) => f.id === current)) return firstFormId;
        return current;
      });

      const modeFormIds = new Set(nextForms.map((f) => f.id));
      const nextSubmissions = ((submissionRows as EventRegistrationSubmission[]) ?? []).filter((s) =>
        modeFormIds.has(s.form_id),
      );
      setSubmissions(nextSubmissions);

      const formIds = nextForms.map((f) => f.id);
      const submissionIds = nextSubmissions.map((s) => s.id);

      const [answersResult, questionsResult] = await Promise.all([
        submissionIds.length > 0
          ? supabase
              .from('event_registration_answers')
              .select('*')
              .in('submission_id', submissionIds)
              .limit(5000)
          : Promise.resolve({ data: [] as EventRegistrationAnswer[], error: null }),
        formIds.length > 0
          ? supabase
              .from('event_registration_questions')
              .select('*')
              .in('form_id', formIds)
              .order('sort_order', { ascending: true })
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as EventRegistrationQuestion[], error: null }),
      ]);

      if (answersResult.error) throw answersResult.error;
      if (questionsResult.error) throw questionsResult.error;
      setAnswers((answersResult.data as EventRegistrationAnswer[]) ?? []);
      setMeetingRequests((requestRows as EventMeetingInterestRequest[]) ?? []);
      setReviews((reviewRows as EventMatchReview[]) ?? []);
      setScheduledMeetings((schedRows as EventMatchScheduledMeeting[]) ?? []);

      const qList = (questionsResult.data as EventRegistrationQuestion[]) ?? [];
      setQuestions(qList);
      const resolvedFormId =
        selectedFormId && manageable.some((f) => f.id === selectedFormId)
          ? selectedFormId
          : firstFormId;
      setSelectedQuestionId((current) => {
        if (current) {
          const selected = qList.find((q) => q.id === current);
          if (selected) return current;
        }
        const forForm = qList.filter((q) => q.form_id === resolvedFormId);
        return forForm[0]?.id ?? '';
      });

      if (qList.length > 0) {
        const { data: optionRows, error: optionErr } = await supabase
          .from('event_registration_question_options')
          .select('*')
          .in(
            'question_id',
            qList.map((q) => q.id),
          )
          .order('sort_order', { ascending: true });
        if (optionErr) throw optionErr;
        setQuestionOptions((optionRows as EventRegistrationQuestionOption[]) ?? []);
      } else {
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
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void isCurrentUserPlatformAdmin().then((value) => {
      if (!cancelled) setIsPlatformAdmin(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedQuestionId('');
    editHydratedForQuestionIdRef.current = null;
    questionEditTouchedRef.current = false;
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
      const slug = uniqueFormSlug(
        name,
        forms.map((f) => f.slug ?? '').filter(Boolean),
      );
      const { data, error: insErr } = await supabase
        .from('event_registration_forms')
        .insert({
          event_id: eventId,
          name,
          slug,
          audience: newFormAudience,
          is_standard: isStandard,
          is_active: true,
          sort_order: nextSort,
          section_order: defaultSectionOrderForAudience(newFormAudience),
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      const created = data as EventRegistrationForm;
      const template = isStandard
        ? STANDARD_TEMPLATE_QUESTIONS
        : newFormAudience === 'vendor'
          ? VENDOR_TEMPLATE_QUESTIONS
          : ATTENDEE_TEMPLATE_QUESTIONS;
      const seeded = await insertTemplateQuestionsForForm(created.id, newFormAudience, template, {
        keepAll: isStandard,
      });
      const categorySource = forms.find(
        (existing) => existing.audience === created.audience && existing.id !== created.id,
      );
      if (eventId && categorySource && !isStandard) {
        try {
          await copySolutionCategoriesBetweenForms(
            categorySource.id,
            created.id,
            eventId,
            created.audience === 'vendor' ? 'vendor' : 'attendee',
            { mode: 'merge' },
          );
        } catch (categoryError) {
          // Form/question creation remains successful if category seeding is unavailable.
          if (import.meta.env.DEV) {
            console.warn('New form category seeding skipped:', categoryError);
          }
        }
      }
      setForms((prev) => [...prev, created]);
      setQuestions((prev) => [...prev, ...seeded.questions]);
      setQuestionOptions((prev) => [...prev, ...seeded.options]);
      setSelectedFormId(created.id);
      setNewFormName('');
      setNewFormAudience('attendee');
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Could not create form');
    } finally {
      setSavingForm(false);
    }
  };

  const createStandardForm = async (): Promise<EventRegistrationForm | null> => {
    if (!eventId) return null;
    const nextSort = forms.length > 0 ? Math.max(...forms.map((f) => f.sort_order)) + 1 : 0;
    const slug = uniqueFormSlug(
      STANDARD_FORM_NAME,
      forms.map((f) => f.slug ?? '').filter(Boolean),
    );
    const { data, error: insErr } = await supabase
      .from('event_registration_forms')
      .insert({
        event_id: eventId,
        name: STANDARD_FORM_NAME,
        slug,
        audience: 'attendee',
        is_standard: true,
        is_active: true,
        sort_order: nextSort,
        section_order: ['Registration', 'About you'],
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    const created = data as EventRegistrationForm;
    const seeded = await insertTemplateQuestionsForForm(created.id, 'attendee', STANDARD_TEMPLATE_QUESTIONS, {
      keepAll: true,
    });
    setForms((prev) => [...prev, created]);
    setQuestions((prev) => [...prev, ...seeded.questions]);
    setQuestionOptions((prev) => [...prev, ...seeded.options]);
    setSelectedFormId(created.id);
    return created;
  };

  const deleteForm = async (formId: string) => {
    const form = forms.find((f) => f.id === formId);
    if (!form) return;
    const sameAudience = listManageableForms(forms).filter((f) => f.audience === form.audience);
    if (sameAudience.length <= 1) {
      setFormError(`Keep at least one ${titleizeAudience(form.audience).toLowerCase()} form.`);
      return;
    }
    const label = toDisplayFormName(form);
    setFormError('');
    try {
      const { count, error: countErr } = await supabase
        .from('event_registration_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('form_id', formId);
      if (countErr) throw countErr;
      const submissionCount = count ?? 0;
      if (submissionCount > 0) {
        if (
          !window.confirm(
            `"${label}" has ${submissionCount} registration(s). Remove it from this list and turn off its public link? Existing registrations are kept.`,
          )
        ) {
          return;
        }
      } else if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
        return;
      }
      setDeletingFormId(formId);
      if (submissionCount > 0) {
        // Clear slug so a future track can reuse the URL segment.
        const { error: upErr } = await supabase
          .from('event_registration_forms')
          .update({ is_active: false, slug: null, updated_at: new Date().toISOString() })
          .eq('id', formId);
        if (upErr) throw upErr;
        const nextForms = forms.map((f) =>
          f.id === formId ? { ...f, is_active: false, slug: null } : f,
        );
        setForms(nextForms);
        if (selectedFormId === formId) {
          setSelectedFormId(listManageableForms(nextForms)[0]?.id ?? '');
        }
      } else {
        const { error: delErr } = await supabase.from('event_registration_forms').delete().eq('id', formId);
        if (delErr) throw delErr;
        const removedQIds = new Set(questions.filter((q) => q.form_id === formId).map((q) => q.id));
        const nextForms = forms.filter((f) => f.id !== formId);
        setForms(nextForms);
        setQuestions((prev) => prev.filter((q) => q.form_id !== formId));
        setQuestionOptions((prev) => prev.filter((o) => !removedQIds.has(o.question_id)));
        if (selectedFormId === formId) {
          setSelectedFormId(listManageableForms(nextForms)[0]?.id ?? '');
        }
      }
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Could not delete form');
    } finally {
      setDeletingFormId('');
    }
  };

  const renameForm = async (formId: string) => {
    const name = renameFormValue.trim();
    if (!name) {
      setFormError('Form name is required.');
      return;
    }
    setSavingForm(true);
    setFormError('');
    try {
      const current = forms.find((f) => f.id === formId);
      // Keep existing public slug so published Portal links do not break after rename.
      const others = forms.filter((f) => f.id !== formId);
      const slug =
        (current?.slug ?? '').trim() ||
        uniqueFormSlug(
          name,
          others.map((f) => f.slug ?? '').filter(Boolean),
          formId,
        );
      const { data, error: upErr } = await supabase
        .from('event_registration_forms')
        .update({ name, slug, updated_at: new Date().toISOString() })
        .eq('id', formId)
        .select('*')
        .single();
      if (upErr) throw upErr;
      const updated = data as EventRegistrationForm;
      setForms((prev) => prev.map((f) => (f.id === formId ? updated : f)));
      setRenamingFormId('');
      setRenameFormValue('');
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Could not rename form');
    } finally {
      setSavingForm(false);
    }
  };

  const duplicateForm = async (sourceId: string) => {
    if (!eventId) return;
    const src = forms.find((f) => f.id === sourceId);
    if (!src) return;
    setDuplicatingFormId(sourceId);
    setFormError('');
    try {
      const copyName = `${toDisplayFormName(src)} (copy)`;
      const nextSort = forms.length > 0 ? Math.max(...forms.map((f) => f.sort_order)) + 1 : 0;
      const slug = uniqueFormSlug(
        copyName,
        forms.map((f) => f.slug ?? '').filter(Boolean),
      );
      const { data: formRow, error: formErr } = await supabase
        .from('event_registration_forms')
        .insert({
          event_id: eventId,
          name: copyName,
          slug,
          audience: src.audience,
          description: src.description,
          is_standard: src.is_standard === true,
          is_active: true,
          sort_order: nextSort,
          section_order: src.section_order ?? null,
        })
        .select('*')
        .single();
      if (formErr) throw formErr;
      const createdForm = formRow as EventRegistrationForm;

      const srcQuestions = questions
        .filter((q) => q.form_id === sourceId)
        .sort((a, b) => a.sort_order - b.sort_order);
      const idMap = new Map<string, string>();
      for (const q of srcQuestions) {
        const { data: qRow, error: qErr } = await supabase
          .from('event_registration_questions')
          .insert({
            form_id: createdForm.id,
            prompt: q.prompt,
            question_type: q.question_type,
            is_required: q.is_required,
            section_label: q.section_label,
            field_key: q.field_key,
            help_text: q.help_text,
            placeholder: q.placeholder,
            is_base_question: q.is_base_question === true,
            is_hidden: q.is_hidden === true,
            show_on_profile: q.show_on_profile !== false,
            used_in_matching: q.used_in_matching === true,
            condition_question_id: null,
            condition_value: q.condition_value ?? null,
            sort_order: q.sort_order,
          })
          .select('*')
          .single();
        if (qErr) throw qErr;
        const createdQ = qRow as EventRegistrationQuestion;
        idMap.set(q.id, createdQ.id);
        setQuestions((prev) => [...prev, createdQ]);

        const srcOpts = questionOptions
          .filter((o) => o.question_id === q.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        if (srcOpts.length > 0) {
          const payload = srcOpts.map((o, idx) => ({
            question_id: createdQ.id,
            label: o.label,
            value: o.value,
            sort_order: idx,
          }));
          const { data: newOpts, error: optErr } = await supabase
            .from('event_registration_question_options')
            .insert(payload)
            .select('*');
          if (optErr) throw optErr;
          setQuestionOptions((prev) => [
            ...prev,
            ...((newOpts as EventRegistrationQuestionOption[]) ?? []),
          ]);
        }
      }
      for (const q of srcQuestions) {
        if (!q.condition_question_id) continue;
        const copiedQuestionId = idMap.get(q.id);
        const copiedParentId = idMap.get(q.condition_question_id);
        if (!copiedQuestionId || !copiedParentId) continue;
        const { error: conditionErr } = await supabase
          .from('event_registration_questions')
          .update({
            condition_question_id: copiedParentId,
            condition_value: q.condition_value ?? null,
          })
          .eq('id', copiedQuestionId);
        if (conditionErr) throw conditionErr;
      }

      if (eventId) {
        await copySolutionCategoriesBetweenForms(
          sourceId,
          createdForm.id,
          eventId,
          createdForm.audience === 'vendor' ? 'vendor' : 'attendee',
        );
        setCategoriesRefreshKey((k) => k + 1);
      }

      setForms((prev) => [...prev, createdForm]);
      setSelectedFormId(createdForm.id);
    } catch (e) {
      setFormError(postgrestErrorMessage(e) || 'Could not duplicate form');
    } finally {
      setDuplicatingFormId('');
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
    const needsChoices = questionType === 'single_select' || questionType === 'multi_select';
    if (needsChoices && draftOptionLabels.map((l) => l.trim()).filter(Boolean).length === 0) {
      setQuestionError('Add at least one answer choice before saving a select question.');
      return;
    }
    if (questionConditionParentId && !questionConditionValue.trim()) {
      setQuestionError('Choose the answer that should show this follow-up question.');
      return;
    }
    setSavingQuestion(true);
    setQuestionError('');
    try {
      const formQuestions = questions.filter((q) => q.form_id === selectedFormId);
      const resolvedSectionLabel = useForcedSection
        ? forcedSectionLabel === 'General'
          ? null
          : sectionLabelForDatabase(forcedSectionLabel)
        : questionSectionPick === '__custom__'
          ? sectionLabelForDatabase(questionSectionLabel)
          : questionSectionPick === ''
            ? null
            : sectionLabelForDatabase(questionSectionPick);
      const targetSection = canonicalSectionLabel(resolvedSectionLabel);
      const formAudience = activeForm?.audience ?? 'attendee';
      const sectionPeers = formQuestions.filter((q) =>
        questionMatchesSectionHeading(q, targetSection, formAudience),
      );
      // Always append at the bottom of the target section (shift later questions down).
      const nextSort =
        sectionPeers.length > 0
          ? Math.max(...sectionPeers.map((q) => q.sort_order)) + 1
          : formQuestions.length > 0
            ? Math.max(...formQuestions.map((q) => q.sort_order)) + 1
            : 0;
      const toShift = formQuestions.filter((q) => q.sort_order >= nextSort);
      if (toShift.length > 0) {
        const shifted = [...toShift].sort((a, b) => b.sort_order - a.sort_order);
        for (const q of shifted) {
          const { error: shiftErr } = await supabase
            .from('event_registration_questions')
            .update({ sort_order: q.sort_order + 1 })
            .eq('id', q.id);
          if (shiftErr) throw shiftErr;
        }
      }
      const { data, error: insErr } = await supabase
        .from('event_registration_questions')
        .insert({
          form_id: selectedFormId,
          prompt,
          question_type: questionType,
          is_required: questionRequired,
          condition_question_id: questionConditionParentId || null,
          condition_value: questionConditionParentId ? questionConditionValue.trim() : null,
          section_label: resolvedSectionLabel,
          // Always form-scoped: never copy to the other audience. "Default" only locks edit for event admins.
          is_base_question: false,
          sort_order: nextSort,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      const added = data as EventRegistrationQuestion;
      const needsChoices = questionType === 'single_select' || questionType === 'multi_select';
      const choiceLabels = needsChoices
        ? draftOptionLabels.map((label) => label.trim()).filter(Boolean)
        : [];
      if (choiceLabels.length > 0) {
        const optionRows = choiceLabels.map((label, idx) => ({
          question_id: added.id,
          label,
          value: label,
          sort_order: idx,
        }));
        const { data: newOpts, error: optErr } = await supabase
          .from('event_registration_question_options')
          .insert(optionRows)
          .select('*');
        if (optErr) throw optErr;
        setQuestionOptions((prev) => [...prev, ...((newOpts as EventRegistrationQuestionOption[]) ?? [])]);
      }
      setQuestions((prev) => {
        const shiftedIds = new Set(toShift.map((q) => q.id));
        const next = prev.map((q) =>
          shiftedIds.has(q.id) ? { ...q, sort_order: q.sort_order + 1 } : q,
        );
        return [...next, added].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
      });
      setSelectedQuestionId(added.id);
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
      setQuestionConditionParentId('');
      setQuestionConditionValue('');
      setDraftOptionLabels([]);
      setDraftOptionInput('');
      if (useForcedSection) setAddingQuestionToSection(null);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not add question');
    } finally {
      setSavingQuestion(false);
    }
  };

  const openAddQuestionToSection = (sectionLabel: string) => {
    setAddingQuestionToSection(sectionLabel);
    setSelectedQuestionId('');
    setRenamingSectionLabel(null);
    setQuestionPrompt('');
    setQuestionType('text');
    setQuestionRequired(false);
    setQuestionConditionParentId('');
    setQuestionConditionValue('');
    setDraftOptionLabels([]);
    setDraftOptionInput('');
    setQuestionError('');
    setOptionError('');
    setCollapsedSections((prev) => ({ ...prev, [sectionLabel]: false }));
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      questionEditorAnchorRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  const cancelAddQuestionToSection = () => {
    setAddingQuestionToSection(null);
    setQuestionPrompt('');
    setQuestionType('text');
    setQuestionRequired(false);
    setQuestionConditionParentId('');
    setQuestionConditionValue('');
    setDraftOptionLabels([]);
    setDraftOptionInput('');
  };

  const addDraftOption = () => {
    const label = draftOptionInput.trim();
    if (!label) {
      setOptionError('Option label is required.');
      return;
    }
    if (draftOptionLabels.some((existing) => existing.trim().toLowerCase() === label.toLowerCase())) {
      setOptionError('That choice is already in the list.');
      return;
    }
    setOptionError('');
    setDraftOptionLabels((prev) => [...prev, label]);
    setDraftOptionInput('');
  };

  const beginRenameSection = (sectionLabel: string) => {
    if (sectionContainsBaseQuestions(sectionLabel) && !isPlatformAdmin) {
      setQuestionError('Default sections can only be renamed by a platform admin.');
      return;
    }
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
    setCollapsedSections((prev) => {
      const currentlyCollapsed = prev[sectionLabel] !== false;
      return { ...prev, [sectionLabel]: !currentlyCollapsed };
    });
  };

  const saveFormSectionOrder = async (order: string[], options?: { silent?: boolean }) => {
    if (!activeForm) return;
    setSectionBusy(true);
    if (!options?.silent) setQuestionError('');
    try {
      // Persist content section order only — Stage 1 / terms always renders last on public forms.
      const persistedOrder = order.filter((label) => label.trim().toLowerCase() !== 'stage 1 registration');
      const { data, error: updErr } = await supabase
        .from('event_registration_forms')
        .update({ section_order: persistedOrder })
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

  const reorderSectionByDrag = async (fromLabel: string, toLabel: string) => {
    if (!activeForm || !canDragSection(fromLabel) || !canDropOnSection(toLabel)) return;
    const nextOrder = reorderSectionInOrder(activeFormSectionOrder, fromLabel, toLabel);
    if (nextOrder === activeFormSectionOrder) return;
    await saveFormSectionOrder(nextOrder);
  };

  const setSectionHidden = async (sectionLabel: string, nextHidden: boolean) => {
    if (!activeForm) return;
    const audience = activeForm.audience;
    const inSection = activeQuestions.filter((q) => questionMatchesSectionHeading(q, sectionLabel, audience));
    const ids = inSection.map((q) => q.id);
    if (ids.length === 0) return;
    if (
      nextHidden &&
      isSolutionInterestSection(sectionLabel, inSection) &&
      !window.confirm(
        `Hide "${sectionLabel}"?\n\nSolution categories will also stop appearing on the registration form until this section is shown again.`,
      )
    ) {
      return;
    }
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
    if (
      activeFormSectionOrder.some(
        (label) =>
          canonicalSectionLabel(label).toLowerCase() === canonicalSectionLabel(toLabel).toLowerCase() &&
          canonicalSectionLabel(label) !== canonicalSectionLabel(fromLabel),
      )
    ) {
      setQuestionError('A section with that name already exists.');
      return;
    }
    setSectionBusy(true);
    setQuestionError('');
    try {
      const audience = activeForm.audience;
      const ids = activeQuestions.filter((q) => questionMatchesSectionHeading(q, fromLabel, audience)).map((q) => q.id);
      if (ids.length === 0) return;
      const { error: updErr } = await supabase.from('event_registration_questions').update({ section_label: toLabel }).in('id', ids);
      if (updErr) throw updErr;
      setQuestions((prev) => prev.map((q) => (ids.includes(q.id) ? { ...q, section_label: toLabel } : q)));
      const nextOrder = renameSectionInOrder(activeFormSectionOrder, fromLabel, toLabel);
      await saveFormSectionOrder(nextOrder);
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
    if (sectionContainsBaseQuestions(sectionLabel) && !isPlatformAdmin) {
      setQuestionError('Default sections can only be deleted by a platform admin. Hide the section instead.');
      return;
    }
    const inSection = activeQuestions.filter((q) =>
      questionMatchesSectionHeading(q, sectionLabel, activeForm.audience),
    );
    if (inSection.length === 0) {
      if (!window.confirm(`Remove empty section "${sectionLabel}"?`)) return;
      setSectionBusy(true);
      setQuestionError('');
      try {
        await saveFormSectionOrder(removeSectionFromOrder(activeFormSectionOrder, sectionLabel));
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
      await saveFormSectionOrder(nextOrder);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not delete section');
    } finally {
      setSectionBusy(false);
    }
  };

  const syncQuestionOptionsFromSource = async (
    sourceQuestionId: string,
    targetQuestionId: string,
  ): Promise<EventRegistrationQuestionOption[]> => {
    const srcOpts = questionOptions
      .filter((o) => o.question_id === sourceQuestionId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const { error: delErr } = await supabase
      .from('event_registration_question_options')
      .delete()
      .eq('question_id', targetQuestionId);
    if (delErr) throw delErr;
    if (srcOpts.length === 0) {
      setQuestionOptions((prev) => prev.filter((o) => o.question_id !== targetQuestionId));
      return [];
    }
    const payload = srcOpts.map((o, idx) => ({
      question_id: targetQuestionId,
      label: o.label,
      value: o.value,
      sort_order: idx,
    }));
    const { data: newOpts, error: insErr } = await supabase
      .from('event_registration_question_options')
      .insert(payload)
      .select('*');
    if (insErr) throw insErr;
    const inserted = (newOpts as EventRegistrationQuestionOption[]) ?? [];
    setQuestionOptions((prev) => [
      ...prev.filter((o) => o.question_id !== targetQuestionId),
      ...inserted,
    ]);
    return inserted;
  };

  const clearSectionQuestions = async (sectionLabel: string) => {
    if (!activeForm) return;
    if (sectionLabel === 'General') {
      setQuestionError('General section cannot be cleared.');
      return;
    }
    const inSection = activeQuestions.filter((q) =>
      questionMatchesSectionHeading(q, sectionLabel, activeForm.audience),
    );
    if (inSection.length === 0) {
      setQuestionError('This section has no questions to clear.');
      return;
    }
    const deletableIds = inSection.filter((q) => !q.is_base_question).map((q) => q.id);
    const hideIds = inSection.filter((q) => q.is_base_question).map((q) => q.id);
    const msg =
      `Clear all questions in "${sectionLabel}"?\n\n` +
      `• ${deletableIds.length} custom question${deletableIds.length === 1 ? '' : 's'} will be deleted\n` +
      `• ${hideIds.length} default question${hideIds.length === 1 ? '' : 's'} will be hidden\n\n` +
      'The section heading stays so you can rebuild it.';
    if (!window.confirm(msg)) return;
    setSectionBusy(true);
    setQuestionError('');
    try {
      if (deletableIds.length > 0) {
        const { error: delErr } = await supabase.from('event_registration_questions').delete().in('id', deletableIds);
        if (delErr) throw delErr;
      }
      if (hideIds.length > 0) {
        const { error: hideErr } = await supabase
          .from('event_registration_questions')
          .update({ is_hidden: true })
          .in('id', hideIds);
        if (hideErr) throw hideErr;
      }
      setQuestions((prev) =>
        prev
          .filter((q) => !deletableIds.includes(q.id))
          .map((q) => (hideIds.includes(q.id) ? { ...q, is_hidden: true } : q)),
      );
      if (deletableIds.includes(selectedQuestionId) || hideIds.includes(selectedQuestionId)) {
        setSelectedQuestionId('');
      }
      if (sectionFilterLabel !== 'all' && canonicalSectionLabel(sectionFilterLabel) === canonicalSectionLabel(sectionLabel)) {
        setSectionFilterLabel('all');
      }
      showMatchNotice(`Cleared "${sectionLabel}".`);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not clear section');
    } finally {
      setSectionBusy(false);
    }
  };

  const copyVendorSectionFromDelegate = async (vendorSectionLabel: string) => {
    if (!activeForm || activeForm.audience !== 'vendor') return;
    if (!VENDOR_COPY_FROM_DELEGATE_SECTIONS.has(vendorSectionLabel)) return;
    const sourceForm = delegateFormsForCopy.find((f) => f.id === delegateCopySourceFormId) ?? delegateFormsForCopy[0];
    if (!sourceForm) {
      setQuestionError('Add a delegate form first, then copy into vendor sections.');
      return;
    }
    const delegateQs = questions.filter((q) => q.form_id === sourceForm.id);
    const vendorQs = [...activeQuestions];
    const plan = describeVendorCopyPlan(delegateQs, vendorQs, vendorSectionLabel);
    if (plan.sourceCount === 0) {
      setQuestionError(`No delegate content found to copy into "${vendorSectionLabel}".`);
      return;
    }
    const msg =
      `Copy from "${toDisplayFormName(sourceForm)}" into "${vendorSectionLabel}"?\n\n` +
      `• ${plan.syncCount} matching question${plan.syncCount === 1 ? '' : 's'} will sync settings and answer choices\n` +
      `• ${plan.addCount} custom delegate question${plan.addCount === 1 ? '' : 's'} will be added here\n` +
      '• New solution categories will be added to the existing vendor list (nothing already copied will be removed)\n' +
      '(Default delegate-only questions are skipped.)';
    if (!window.confirm(msg)) return;

    setCopyingSectionLabel(vendorSectionLabel);
    setSectionBusy(true);
    setQuestionError('');
    try {
      const sources = collectDelegateQuestionsForVendorCopy(
        delegateQs,
        DELEGATE_SECTIONS_FOR_VENDOR_TARGET[vendorSectionLabel] ?? [],
      );
      let nextSort = nextSortOrderInSection(vendorQs, vendorSectionLabel);
      const updatedById = new Map<string, EventRegistrationQuestion>();
      const created: EventRegistrationQuestion[] = [];
      const copiedQuestionIds = new Map<string, string>();

      for (const src of sources) {
        const match = findVendorQuestionMatch(src, vendorQs);
        if (match) {
          const { data: row, error: updErr } = await supabase
            .from('event_registration_questions')
            .update({
              is_required: src.is_required,
              help_text: src.help_text,
              placeholder: src.placeholder,
              question_type: src.question_type,
              used_in_matching: src.used_in_matching === true,
            })
            .eq('id', match.id)
            .select('*')
            .single();
          if (updErr) throw updErr;
          const updated = row as EventRegistrationQuestion;
          updatedById.set(updated.id, updated);
          copiedQuestionIds.set(src.id, updated.id);
          if (src.question_type === 'single_select' || src.question_type === 'multi_select') {
            await syncQuestionOptionsFromSource(src.id, match.id);
          }
        } else if (!src.is_base_question) {
          const sectionForDb =
            vendorSectionLabel === 'General' ? null : sectionLabelForDatabase(vendorSectionLabel);
          const { data: row, error: insErr } = await supabase
            .from('event_registration_questions')
            .insert({
              form_id: activeForm.id,
              prompt: src.prompt,
              question_type: src.question_type,
              is_required: src.is_required,
              section_label: sectionForDb,
              help_text: src.help_text,
              placeholder: src.placeholder,
              is_base_question: false,
              is_hidden: false,
              show_on_profile: src.show_on_profile !== false,
              used_in_matching: src.used_in_matching === true,
              sort_order: nextSort,
            })
            .select('*')
            .single();
          if (insErr) throw insErr;
          const added = row as EventRegistrationQuestion;
          nextSort += 1;
          created.push(added);
          vendorQs.push(added);
          copiedQuestionIds.set(src.id, added.id);
          if (src.question_type === 'single_select' || src.question_type === 'multi_select') {
            await syncQuestionOptionsFromSource(src.id, added.id);
          }
        }
      }

      for (const src of sources) {
        const targetId = copiedQuestionIds.get(src.id);
        if (!targetId) continue;
        const parentId = src.condition_question_id
          ? copiedQuestionIds.get(src.condition_question_id)
          : null;
        const { error: conditionErr } = await supabase
          .from('event_registration_questions')
          .update({
            condition_question_id: parentId ?? null,
            condition_value: parentId ? src.condition_value?.trim() || null : null,
          })
          .eq('id', targetId);
        if (conditionErr) throw conditionErr;
      }

      let categoryCount = 0;
      if (eventId && activeForm) {
        categoryCount = await copySolutionCategoriesBetweenForms(
          sourceForm.id,
          activeForm.id,
          eventId,
          'vendor',
          { mode: 'merge' },
        );
        setCategoriesRefreshKey((k) => k + 1);
      }

      setQuestions((prev) => {
        const createdIds = new Set(created.map((q) => q.id));
        const next = prev.map((q) => updatedById.get(q.id) ?? q);
        return [...next.filter((q) => !createdIds.has(q.id)), ...created].sort(
          (a, b) => a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt),
        );
      });
      showMatchNotice(
        `Copied delegate content into "${vendorSectionLabel}"` +
          (categoryCount > 0 ? ` (${categoryCount} solution categories)` : '') +
          '.',
      );
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not copy from delegate');
    } finally {
      setCopyingSectionLabel('');
      setSectionBusy(false);
    }
  };

  const setQuestionsOnProfile = async (questionIds: string[], nextShow: boolean) => {
    const ids = nextShow
      ? questionIds.filter((id) => {
          const q = questions.find((item) => item.id === id);
          return q ? !isRegistrationContactPrompt(q.prompt) : false;
        })
      : questionIds;
    if (ids.length === 0) return;
    try {
      const { error: updErr } = await supabase
        .from('event_registration_questions')
        .update({ show_on_profile: nextShow })
        .in('id', ids);
      if (updErr) throw updErr;
      setQuestions((prev) => prev.map((q) => (ids.includes(q.id) ? { ...q, show_on_profile: nextShow } : q)));
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not update profile visibility');
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
    if (isRegistrationIdentityLockedPrompt(q.prompt)) {
      setQuestionError(
        'Identity fields (Company Name, First Name, Email, etc.) cannot be deleted — they power the registration header. Hide unused extras instead, or add a new custom question.',
      );
      return;
    }
    if (q.is_base_question && !isPlatformAdmin) {
      setQuestionError('Default questions can only be deleted by a platform admin. Hide them instead.');
      return;
    }
    if (!window.confirm(q.is_base_question ? 'Delete this default question? Prefer Hide unless you are sure.' : 'Delete this custom question?')) return;
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
          help_text: src.help_text,
          placeholder: src.placeholder,
          used_in_matching: src.used_in_matching ?? false,
          is_hidden: false,
          show_on_profile: src.show_on_profile !== false,
          is_base_question: false,
          condition_question_id: src.condition_question_id ?? null,
          condition_value: src.condition_value ?? null,
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

  const countActivationEmailRecipients = (
    activatingDelegateStage2: boolean,
    activatingVendorStage2: boolean,
    activatingMeetingRequests: boolean,
  ): number => {
    const emails = new Set<string>();
    for (const row of submissions) {
      if (row.status !== 'submitted') continue;
      const email = row.email?.trim().toLowerCase();
      if (!email?.includes('@')) continue;
      const isVendor = row.attendee_type === 'vendor';
      const applies =
        activatingMeetingRequests ||
        (activatingDelegateStage2 && !isVendor) ||
        (activatingVendorStage2 && isVendor);
      if (applies) emails.add(email);
    }
    return emails.size;
  };

  const persistPortalSettings = async (opts?: {
    sendActivationEmail?: boolean;
    activatingDelegateStage2?: boolean;
    activatingVendorStage2?: boolean;
    activatingMeetingRequests?: boolean;
  }) => {
    if (!eventId) return;
    const sendActivationEmail = Boolean(opts?.sendActivationEmail);
    const activatingDelegateStage2 = Boolean(opts?.activatingDelegateStage2);
    const activatingVendorStage2 = Boolean(opts?.activatingVendorStage2);
    const activatingMeetingRequests = Boolean(opts?.activatingMeetingRequests);

    setSavingPortalSettings(true);
    setError('');
    setPortalSaveNote('');
    try {
      const sanitizedHotel = hasRichTextContent(delegateHotelContent)
        ? sanitizeHtml(delegateHotelContent)
        : '';
      const sanitizedHolding = hasRichTextContent(stage2HoldingMessage)
        ? sanitizeHtml(stage2HoldingMessage)
        : defaultHoldingBodyHtml();
      const { error: upsertErr } = await supabase.from('event_matchmaking_settings').upsert({
        event_id: eventId,
        registration_open: registrationOpen,
        meeting_requests_open: meetingRequestsOpen,
        portal_match_suggestions_vendors_enabled: vendorMatchSuggestionsEnabled,
        portal_match_suggestions_delegates_enabled: delegateMatchSuggestionsEnabled,
        portal_match_suggestions_enabled: vendorMatchSuggestionsEnabled || delegateMatchSuggestionsEnabled,
        portal_received_requests_visible: portalReceivedRequestsVisible,
        delegate_portal_hotel_visible: delegateHotelVisible,
        delegate_hotel_content: sanitizedHotel || null,
        registration_notify_team_emails: registrationNotifyTeamEmails.trim() || null,
        registration_from_email: registrationFromEmail.trim() || null,
        delegate_stage2_active: delegateStage2Active,
        vendor_stage2_active: vendorStage2Active,
        registration_flow_mode: registrationFlowMode,
        stage2_holding_message: sanitizedHolding,
        stage2_expected_open_at: stage2ExpectedOpenAt.trim()
          ? new Date(stage2ExpectedOpenAt).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;
      setDelegateHotelContent(sanitizedHotel);
      setStage2HoldingMessage(sanitizedHolding);

      setSavedActivationFlags({
        delegateStage2: delegateStage2Active,
        vendorStage2: vendorStage2Active,
        meetingRequests: meetingRequestsOpen,
      });

      if (
        sendActivationEmail &&
        (activatingDelegateStage2 || activatingVendorStage2 || activatingMeetingRequests)
      ) {
        const result = await notifyPortalFeaturesOpened({
          event_id: eventId,
          activate_delegate_stage2: activatingDelegateStage2,
          activate_vendor_stage2: activatingVendorStage2,
          activate_meeting_requests: activatingMeetingRequests,
        });
        if (result.reason === 'RESEND_API_KEY not configured') {
          setPortalSaveNote('Settings saved, but activation emails could not be sent (email service not configured).');
        } else {
          setPortalSaveNote(
            `Settings saved. Activation email sent to ${result.emailed} registered user${result.emailed === 1 ? '' : 's'}.`,
          );
        }
      } else if (
        activatingDelegateStage2 ||
        activatingVendorStage2 ||
        activatingMeetingRequests
      ) {
        setPortalSaveNote('Settings saved. No activation email sent.');
      } else {
        setPortalSaveNote('Settings saved.');
      }
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not save delegate portal settings');
    } finally {
      setSavingPortalSettings(false);
    }
  };

  const savePortalSettings = async () => {
    if (!eventId) return;

    const activatingDelegateStage2 = delegateStage2Active && !savedActivationFlags.delegateStage2;
    const activatingVendorStage2 = vendorStage2Active && !savedActivationFlags.vendorStage2;
    const activatingMeetingRequests = meetingRequestsOpen && !savedActivationFlags.meetingRequests;
    const willPromptForEmail =
      activatingDelegateStage2 || activatingVendorStage2 || activatingMeetingRequests;

    if (willPromptForEmail) {
      const parts: string[] = [];
      if (activatingDelegateStage2) parts.push('Delegate Registration Details');
      if (activatingVendorStage2) parts.push('Vendor Registration Details');
      if (activatingMeetingRequests) parts.push('Meeting Requests');
      setActivationConfirm({
        parts,
        recipientCount: countActivationEmailRecipients(
          activatingDelegateStage2,
          activatingVendorStage2,
          activatingMeetingRequests,
        ),
        sendEmail: true,
        activatingDelegateStage2,
        activatingVendorStage2,
        activatingMeetingRequests,
      });
      return;
    }

    await persistPortalSettings();
  };

  const confirmActivationSave = async () => {
    if (!activationConfirm) return;
    const pending = activationConfirm;
    setActivationConfirm(null);
    await persistPortalSettings({
      sendActivationEmail: pending.sendEmail,
      activatingDelegateStage2: pending.activatingDelegateStage2,
      activatingVendorStage2: pending.activatingVendorStage2,
      activatingMeetingRequests: pending.activatingMeetingRequests,
    });
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

  const updateRegistrationStatus = async (submission: EventRegistrationSubmission, status: 'approved' | 'rejected') => {
    if (
      status === 'rejected' &&
      !window.confirm(
        'Reject this registrant?\n\n• They are blocked from the portal\n• Their Members / app access for this event is turned off\n• Their login account is kept (not deleted)',
      )
    ) {
      return;
    }
    setSubmissionActionId(submission.id);
    setError('');
    try {
      const result = await syncRegistrationMembership({
        submission_id: submission.id,
        status,
      });
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submission.id
            ? {
                ...s,
                registration_status: status,
                rejected_at: status === 'rejected' ? new Date().toISOString() : null,
                user_id: result.user_id ?? s.user_id,
              }
            : s,
        ),
      );
      showMatchNotice(
        result.message ||
          (status === 'approved'
            ? 'Approved and added to Members.'
            : 'Rejected. Portal blocked and app membership turned off for this event.'),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : postgrestErrorMessage(e) || 'Could not update registration status');
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

  const viewPortalAsMember = async (
    submission: EventRegistrationSubmission,
    page: 'welcome' | 'registration' = 'welcome',
  ) => {
    if (!eventId) return;
    setSubmissionActionId(submission.id);
    setError('');
    try {
      const result = await openPortalViewAsSubmission({
        eventId,
        submissionId: submission.id,
        attendeeType: submission.attendee_type,
        firstName: submission.first_name,
        lastName: submission.last_name,
        email: submission.email,
        companyName: submission.company_name,
        page,
      });
      if (!result.ok) {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open portal view');
    } finally {
      setSubmissionActionId('');
    }
  };


  const publishMeetingToApp = async (meetingId: string, opts?: { skipConfirm?: boolean }) => {
    if (
      !opts?.skipConfirm &&
      !window.confirm(
        'Publish this meeting to the mobile app? This creates a booking in the existing B2B system.',
      )
    ) {
      return;
    }
    setPublishingMeetingId(meetingId);
    setError('');
    try {
      const { error: rpcErr } = await supabase.rpc('publish_matchmaking_meeting_to_app', {
        p_meeting_id: meetingId,
      });
      if (rpcErr) throw rpcErr;
      await load({ silent: true });
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not publish meeting to app');
    } finally {
      setPublishingMeetingId('');
    }
  };

  const publishAllMeetingsToApp = async (meetingIds: string[]) => {
    const ids = meetingIds.filter(Boolean);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Publish ${ids.length} meeting${ids.length === 1 ? '' : 's'} to the mobile app? This creates bookings in the existing B2B system.`,
      )
    ) {
      return;
    }
    setPublishingMeetingId('__all__');
    setError('');
    let published = 0;
    let failed = 0;
    let lastError = '';
    try {
      for (const meetingId of ids) {
        const { error: rpcErr } = await supabase.rpc('publish_matchmaking_meeting_to_app', {
          p_meeting_id: meetingId,
        });
        if (rpcErr) {
          failed += 1;
          lastError = postgrestErrorMessage(rpcErr) || rpcErr.message || 'Publish failed';
        } else {
          published += 1;
        }
      }
      await load({ silent: true });
      if (failed > 0) {
        setError(
          lastError
            ? `Published ${published}, ${failed} failed. ${lastError}`
            : `Published ${published}, ${failed} failed.`,
        );
      } else {
        showMatchNotice(
          `Published ${published} meeting${published === 1 ? '' : 's'} to the app.`,
        );
      }
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not publish meetings to app');
    } finally {
      setPublishingMeetingId('');
    }
  };

  const moveQuestion = async (questionId: string, dir: -1 | 1) => {
    const target = activeQuestions.find((q) => q.id === questionId);
    if (!target || !activeForm) return;
    // Match admin section grouping (incl. Registration header fields).
    const section = resolveRegistrationSectionLabel(target, activeForm.audience);
    const list = activeQuestions.filter(
      (q) => resolveRegistrationSectionLabel(q, activeForm.audience) === section,
    );
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
      await load({ silent: true });
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not reorder question');
    }
  };

  const addOptionToSelected = async () => {
    if (!selectedQuestionId || !selectedQuestion) return;
    if (selectedQuestion.is_base_question && !isPlatformAdmin) {
      setOptionError('Default question choices can only be edited by a platform admin.');
      return;
    }
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
    if (selectedQuestion?.is_base_question && !isPlatformAdmin) {
      setOptionError('Default question choices can only be edited by a platform admin.');
      return;
    }
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
    if (!selectedQuestion || !activeForm || selectedQuestion.form_id !== activeForm.id) return;
    if (selectedQuestion.is_base_question && !isPlatformAdmin) {
      setQuestionError('Default questions can only be edited by a platform admin. You can hide them or add custom questions.');
      return;
    }
    const identityLocked = isRegistrationIdentityLockedPrompt(selectedQuestion.prompt);
    const prompt = identityLocked ? selectedQuestion.prompt : editingQuestionPrompt.trim();
    const questionType = identityLocked ? selectedQuestion.question_type : editingQuestionType;
    if (!prompt) {
      setQuestionError('Question prompt is required.');
      return;
    }
    if (
      identityLocked &&
      (normalizeRegistrationPrompt(editingQuestionPrompt) !== normalizeRegistrationPrompt(selectedQuestion.prompt) ||
        editingQuestionType !== selectedQuestion.question_type)
    ) {
      setQuestionError(
        'Company Name, First Name, Last Name, Email, Job Title, and Cell Phone cannot be renamed or have their answer type changed — that overwrites the registration header fields. Add a new custom question instead.',
      );
      setEditingQuestionPrompt(selectedQuestion.prompt);
      setEditingQuestionType(selectedQuestion.question_type);
      return;
    }
    if (editingQuestionConditionParentId && !editingQuestionConditionValue.trim()) {
      setQuestionError('Choose the answer that should show this follow-up question.');
      return;
    }
    if (
      editingQuestionConditionParentId &&
      !conditionalParentOptions(activeQuestions, questionOptions, selectedQuestion.id).some(
        (parent) => parent.id === editingQuestionConditionParentId,
      )
    ) {
      setQuestionError('Choose a valid parent question from this form.');
      return;
    }
    setSavingQuestionEdit(true);
    setQuestionError('');
    try {
      const canUseInMatching = !['text', 'textarea', 'email'].includes(questionType);
      const audience = activeForm?.audience ?? 'attendee';
      const nextSectionLabel = identityLocked
        ? sectionLabelForDatabase(resolveRegistrationSectionLabel(selectedQuestion, audience))
        : sectionLabelForDatabase(editingQuestionSectionLabel.trim());
      const prevSection = canonicalSectionLabel(
        resolveRegistrationSectionLabel(selectedQuestion, audience),
      );
      const nextSection = canonicalSectionLabel(nextSectionLabel);
      const sectionChanged = prevSection !== nextSection;
      const patch: Record<string, unknown> = {
        prompt,
        question_type: questionType,
        is_required: editingQuestionRequired,
        section_label: nextSectionLabel,
        condition_question_id: editingQuestionConditionParentId || null,
        condition_value: editingQuestionConditionParentId ? editingQuestionConditionValue.trim() : null,
        used_in_matching: canUseInMatching ? editingQuestionUsedInMatching : false,
      };
      if (isPlatformAdmin) {
        // Default flag is metadata only — never copies this question to the other audience form.
        patch.is_base_question = editingQuestionIsDefault;
      }
      if (sectionChanged && selectedFormId) {
        const formQuestions = questions.filter((q) => q.form_id === selectedFormId && q.id !== selectedQuestion.id);
        const sectionPeers = formQuestions.filter((q) =>
          questionMatchesSectionHeading(q, nextSection, audience),
        );
        const nextSort =
          sectionPeers.length > 0
            ? Math.max(...sectionPeers.map((q) => q.sort_order)) + 1
            : formQuestions.length > 0
              ? Math.max(...formQuestions.map((q) => q.sort_order)) + 1
              : 0;
        const toShift = formQuestions.filter((q) => q.sort_order >= nextSort);
        if (toShift.length > 0) {
          const shifted = [...toShift].sort((a, b) => b.sort_order - a.sort_order);
          for (const q of shifted) {
            const { error: shiftErr } = await supabase
              .from('event_registration_questions')
              .update({ sort_order: q.sort_order + 1 })
              .eq('id', q.id);
            if (shiftErr) throw shiftErr;
          }
        }
        patch.sort_order = nextSort;
        setQuestions((prev) => {
          const shiftedIds = new Set(toShift.map((q) => q.id));
          return prev.map((q) => {
            if (shiftedIds.has(q.id)) return { ...q, sort_order: q.sort_order + 1 };
            return q;
          });
        });
      }
      const { data: updatedRow, error: updErr } = await supabase
        .from('event_registration_questions')
        .update(patch)
        .eq('id', selectedQuestion.id)
        .select('*')
        .single();
      if (updErr) throw updErr;
      const merged = updatedRow as EventRegistrationQuestion;
      questionEditTouchedRef.current = false;
      setQuestions((prev) =>
        prev
          .map((q) => (q.id === selectedQuestion.id ? { ...q, ...merged } : q))
          .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
      );
      if (activeForm && nextSection !== 'General') {
        const nextOrder = addSectionToOrder(activeFormSectionOrder, nextSection);
        if (nextOrder.length !== activeFormSectionOrder.length) {
          await saveFormSectionOrder(nextOrder, { silent: true });
        }
      }
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
      formNameById.get(row.form_id) ?? '',
      row.status,
      row.submitted_at ?? '',
      row.created_at,
    ]);
    const header = [
      'first_name',
      'last_name',
      'email',
      'company_name',
      'job_title',
      'audience',
      'form',
      'status',
      'submitted_at',
      'created_at',
    ];
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

  const loadScheduleOptions = useCallback(async () => {
    if (!eventId) return;
    const [slotResult, locationResult] = await Promise.all([
      supabase
        .from('event_matchmaking_time_slots')
        .select('*')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('start_time', { ascending: true }),
      supabase
        .from('event_matchmaking_locations')
        .select('*')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ]);
    if (slotResult.error) throw slotResult.error;
    if (locationResult.error) throw locationResult.error;
    const nextSlots = (slotResult.data as EventMatchmakingTimeSlot[]) ?? [];
    const nextLocations = (locationResult.data as EventMatchmakingLocation[]) ?? [];
    setScheduleTimeSlots(nextSlots);
    setScheduleLocations(nextLocations);
    setScheduleTimeSlotId((current) =>
      nextSlots.some((slot) => slot.id === current) ? current : (nextSlots[0]?.id ?? '')
    );
    setScheduleLocationId((current) =>
      current && nextLocations.some((location) => location.id === current) ? current : '',
    );
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    void (async () => {
      const { data } = await supabase
        .from('event_matchmaking_settings')
        .select('default_meeting_minutes, auto_slot_start_hour, auto_slot_end_hour')
        .eq('event_id', eventId)
        .maybeSingle();
      if (!data) return;
      setAutoSlotDefaults({
        default_meeting_minutes:
          (data as AutoSlotDefaults).default_meeting_minutes ??
          DEFAULT_AUTO_SLOT_SETTINGS.default_meeting_minutes,
        auto_slot_start_hour:
          (data as AutoSlotDefaults).auto_slot_start_hour ??
          DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_start_hour,
        auto_slot_end_hour:
          (data as AutoSlotDefaults).auto_slot_end_hour ??
          DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_end_hour,
      });
    })();
  }, [eventId]);

  useEffect(() => {
    if (activeTab !== 'schedule' && activeTab !== 'matching' && activeTab !== 'slots') return;
    loadScheduleOptions().catch((cause) => {
      setError(postgrestErrorMessage(cause) || 'Could not load meeting time slots and locations');
    });
  }, [activeTab, loadScheduleOptions]);

  const scheduleApprovedMatch = async (
    review: EventMatchReview,
    timeSlotId = scheduleTimeSlotId,
    locationId = scheduleLocationId,
  ) => {
    if (!eventId || !timeSlotId || !locationId) {
      setError('Create and select a time slot and location before scheduling.');
      return;
    }
    try {
      setScheduleActionId(review.id);
      setError('');
      const { error: scheduleError } = await supabase.rpc('schedule_matchmaking_review', {
        p_review_id: review.id,
        p_time_slot_id: timeSlotId,
        p_location_id: locationId,
        p_notes: null,
        p_override_availability: false,
      });
      if (scheduleError) throw scheduleError;
      await load({ silent: true });
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not schedule match');
    } finally {
      setScheduleActionId('');
    }
  };

  const rescheduleMeeting = async (
    meeting: EventMatchScheduledMeeting,
    timeSlotId = scheduleTimeSlotId,
    locationId = scheduleLocationId,
    notes?: string | null,
  ) => {
    if (!timeSlotId || !locationId) {
      setError('Select the new time slot and location first.');
      return;
    }
    setScheduleActionId(meeting.id);
    setError('');
    try {
      const { error: rescheduleError } = await supabase.rpc('reschedule_matchmaking_meeting', {
        p_meeting_id: meeting.id,
        p_time_slot_id: timeSlotId,
        p_location_id: locationId,
        p_notes: notes !== undefined ? notes : (meeting.notes ?? null),
        p_override_availability: false,
      });
      if (rescheduleError) throw rescheduleError;
      showMatchNotice('Meeting updated.');
      await load({ silent: true });
      await loadScheduleOptions();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update meeting');
    } finally {
      setScheduleActionId('');
    }
  };

  const cancelScheduledMeeting = async (meeting: EventMatchScheduledMeeting) => {
    if (!window.confirm('Cancel this meeting? Published mobile bookings will also be cancelled.')) return;
    setScheduleActionId(meeting.id);
    setError('');
    try {
      const { error: cancelError } = await supabase.rpc('cancel_matchmaking_meeting', {
        p_meeting_id: meeting.id,
      });
      if (cancelError) throw cancelError;
      await load({ silent: true });
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not cancel meeting');
    } finally {
      setScheduleActionId('');
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
        let form =
          workingForms.find((f) => f.audience === audience && f.name === name && f.is_active !== false) ?? null;
        const legacyForms = workingForms.filter(
          (f) => f.audience === audience && isLegacyImportedFormName(f.name) && f.is_active !== false,
        );

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
          const existingForAudience = workingForms.find(
            (f) => f.audience === audience && !isLegacyImportedFormName(f.name) && f.is_active !== false,
          );
          // Multi-track: if any delegate/vendor form already exists (even renamed), do not
          // recreate the default "KBM … Registration" form — that caused a third card after rename.
          if (existingForAudience) {
            return;
          }
          const nextSort = workingForms.length > 0 ? Math.max(...workingForms.map((f) => f.sort_order)) + 1 : 0;
          const slug = uniqueFormSlug(
            name,
            workingForms.map((f) => f.slug ?? '').filter(Boolean),
          );
          const { data: createdForm, error: formInsertErr } = await supabase
            .from('event_registration_forms')
            .insert({
              event_id: eventId,
              name,
              slug,
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
        // Migrate legacy C-suite Yes/No → Seniority Level (same option set as vendor target seniority).
        if (audience === 'attendee') {
          const legacyCsuite = existingQuestions.find(
            (q) => normalizeRegistrationPrompt(q.prompt) === normalizeRegistrationPrompt(LEGACY_DELEGATE_CSUITE_PROMPT),
          );
          const alreadySeniority = existingQuestions.find(
            (q) => normalizeRegistrationPrompt(q.prompt) === normalizeRegistrationPrompt(DELEGATE_SENIORITY_PROMPT),
          );
          if (legacyCsuite && !alreadySeniority) {
            const { error: renameErr } = await supabase
              .from('event_registration_questions')
              .update({
                prompt: DELEGATE_SENIORITY_PROMPT,
                question_type: 'single_select',
                is_required: true,
                used_in_matching: true,
                is_base_question: true,
                is_hidden: false,
              })
              .eq('id', legacyCsuite.id);
            if (renameErr) throw renameErr;
            legacyCsuite.prompt = DELEGATE_SENIORITY_PROMPT;
            const { error: clearOptErr } = await supabase
              .from('event_registration_question_options')
              .delete()
              .eq('question_id', legacyCsuite.id);
            if (clearOptErr) throw clearOptErr;
            const { error: seedOptErr } = await supabase.from('event_registration_question_options').insert(
              DELEGATE_SENIORITY_OPTIONS.map((value, optionIdx) => ({
                question_id: legacyCsuite.id,
                label: value,
                value,
                sort_order: optionIdx,
              })),
            );
            if (seedOptErr) throw seedOptErr;
          }
        }

        const existingByPrompt = new Map(existingQuestions.map((q) => [q.prompt.trim().toLowerCase(), q]));
        const legacyHiddenNorms = new Set(
          [
            ...LEGACY_DELEGATE_STAGE2_HIDDEN_PROMPTS,
            LEGACY_DELEGATE_CSUITE_PROMPT,
          ].map((p) => normalizeRegistrationPrompt(p)),
        );

        let rollingSectionHeading: string | null = null;
        for (const [idx, q] of templateQuestions.entries()) {
          if (q.section_label?.trim()) {
            rollingSectionHeading = q.section_label.trim();
          }
          const sectionForDb = sectionLabelForDatabase(rollingSectionHeading);

          const existing = existingByPrompt.get(q.prompt.trim().toLowerCase());
          const keepForStage1 = isStage1RegistrationQuestion(audience, q.prompt);
          const hiddenByDefault = isRegistrationQuestionHiddenByDefault(audience, q.prompt);

          if (existing) {
            // Only realign seeded defaults — never hijack admin custom questions that share a prompt.
            if (existing.is_base_question) {
              // Purge legacy Stage-2 junk, but keep Stage 1 fields (e.g. Terms) for public registration.
              if (hiddenByDefault && !keepForStage1) {
                const { error: delStaleErr } = await supabase
                  .from('event_registration_questions')
                  .delete()
                  .eq('id', existing.id);
                if (delStaleErr) throw delStaleErr;
                continue;
              }
              const { error: patchErr } = await supabase
                .from('event_registration_questions')
                .update({
                  question_type: q.question_type,
                  is_required: q.is_required ?? false,
                  section_label: sectionForDb,
                  is_base_question: true,
                  // Stage 1 Terms must stay visible on public registration; Stage 2 portal filters it out.
                  ...(keepForStage1 ? { is_hidden: false } : {}),
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
            }
            continue;
          }
          // Skip legacy leftovers; still seed Stage 1 prompts needed by public registration.
          if (hiddenByDefault && !keepForStage1) {
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
              is_hidden: false,
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

        // Permanently remove known legacy leftovers (not Stage 1 registration fields).
        const toDeleteDeprecated = existingQuestions.filter((q) => {
          if (!q.is_base_question) return false;
          if (isStage1RegistrationQuestion(audience, q.prompt)) return false;
          const norm = normalizeRegistrationPrompt(q.prompt);
          if (audience === 'vendor' && VENDOR_ALWAYS_HIDDEN_PROMPTS.has(norm)) return true;
          if (audience === 'attendee' && legacyHiddenNorms.has(norm)) return true;
          if (isRegistrationQuestionHiddenByDefault(audience, q.prompt)) return true;
          return false;
        });
        if (toDeleteDeprecated.length > 0) {
          const { error: delErr } = await supabase
            .from('event_registration_questions')
            .delete()
            .in(
              'id',
              toDeleteDeprecated.map((q) => q.id),
            );
          if (delErr) throw delErr;
        }
      };

      await upsertTemplate('attendee', KBM_ATTENDEE_FORM_NAME, ATTENDEE_TEMPLATE_QUESTIONS);
      await upsertTemplate('vendor', KBM_VENDOR_FORM_NAME, VENDOR_TEMPLATE_QUESTIONS);
      await load({ silent: true });
    } catch (e) {
      setTemplateError(postgrestErrorMessage(e) || 'Could not install default templates');
    } finally {
      setEnsuringDefaults(false);
    }
  };

  useEffect(() => {
    if (!eventId || loading || didInitialDefaultSync) return;
    setDidInitialDefaultSync(true);
    // Skip heavy template sync when forms already exist — it was re-running on every visit.
    if (listManageableForms(forms).length > 0) return;
    if (!ensuringDefaults) {
      void installDefaultTemplates();
    }
  }, [eventId, loading, didInitialDefaultSync, ensuringDefaults, forms]);

  useEffect(() => {
    if (!selectedQuestionId) {
      editHydratedForQuestionIdRef.current = null;
      questionEditTouchedRef.current = false;
      setEditingQuestionPrompt('');
      setEditingQuestionType('text');
      setEditingQuestionRequired(false);
      setEditingQuestionIsDefault(false);
      setEditingQuestionSectionLabel('');
      setEditingQuestionConditionParentId('');
      setEditingQuestionConditionValue('');
      setEditingQuestionUsedInMatching(false);
      return;
    }
    const q = questions.find((item) => item.id === selectedQuestionId);
    if (!q) return;

    const alreadyHydrated = editHydratedForQuestionIdRef.current === selectedQuestionId;
    if (!alreadyHydrated) {
      editHydratedForQuestionIdRef.current = selectedQuestionId;
      questionEditTouchedRef.current = false;
      const audience = activeForm?.audience ?? 'attendee';
      const displaySection = resolveRegistrationSectionLabel(q, audience);
      setEditingQuestionPrompt(q.prompt);
      setEditingQuestionType(q.question_type);
      setEditingQuestionRequired(Boolean(q.is_required));
      setEditingQuestionIsDefault(Boolean(q.is_base_question));
      setEditingQuestionSectionLabel(displaySection === 'General' ? '' : displaySection);
      setEditingQuestionConditionParentId(q.condition_question_id ?? '');
      setEditingQuestionConditionValue(q.condition_value ?? '');
      setEditingQuestionUsedInMatching(Boolean(q.used_in_matching));
      return;
    }

    if (!questionEditTouchedRef.current) {
      const audience = activeForm?.audience ?? 'attendee';
      const displaySection = resolveRegistrationSectionLabel(q, audience);
      setEditingQuestionPrompt(q.prompt);
      setEditingQuestionType(q.question_type);
      setEditingQuestionRequired(Boolean(q.is_required));
      setEditingQuestionIsDefault(Boolean(q.is_base_question));
      setEditingQuestionSectionLabel(displaySection === 'General' ? '' : displaySection);
      setEditingQuestionConditionParentId(q.condition_question_id ?? '');
      setEditingQuestionConditionValue(q.condition_value ?? '');
      setEditingQuestionUsedInMatching(Boolean(q.used_in_matching));
    }
  }, [selectedQuestionId, questions, activeForm]);

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
    if (isStandard || !activeForm || activeQuestions.length === 0 || repairingSections) return;
    const sectionMap = sectionMapForAudience(activeForm.audience);
    const toRepair = activeQuestions
      .map((q) => {
        // Header-grid fields always belong in Registration (match public form).
        const resolved = resolveRegistrationSectionLabel(q, activeForm.audience);
        const expectedSection =
          resolved === 'Registration' ? 'Registration' : sectionMap.get(normalizePrompt(q.prompt));
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
    const parsed = parseMatchmakingTab(tabParam);
    if (parsed && tabList.some((t) => t.id === parsed)) return;
    navigate(`/events/${eventId}/${routeBase}/${defaultTab}`, { replace: true });
  }, [eventId, tabParam, navigate, tabList, routeBase, defaultTab]);

  useEffect(() => {
    if (!eventId || tabParam) return;
    navigate(`/events/${eventId}/${routeBase}/${defaultTab}`, { replace: true });
  }, [eventId, tabParam, navigate, routeBase, defaultTab]);

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
    navigate(`/events/${eventId}/${routeBase}/${tab}`);
  }

  if (!eventId) return <div className={styles.error}>Missing event</div>;
  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <header className={styles.enterpriseHeader}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
        <h1>{isStandard ? 'Standard registration' : 'Matchmaking'}</h1>
        <span className={styles.enterpriseEventName}>{event?.name ?? 'Event'}</span>
      </header>
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.tabBarSticky}>
        <nav className={styles.tabs} aria-label="Matchmaking sections">
          {tabList.map(({ id, label }) => (
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
      {activeTab === 'website' && isStandard ? (
        <StandardRegistrationSetup
          eventId={eventId}
          eventName={event?.name ?? ''}
          standardForm={visibleForms[0] ?? null}
          onCreateForm={createStandardForm}
        />
      ) : null}
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
          Turn registration on when you are ready to accept sign-ups. Copy a link for each track — multiple
          delegate forms get their own URL (slug).
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
              {registrationOpen ? 'New sign-ups are allowed.' : 'Registration links show as closed.'}
            </span>
          </span>
        </label>
        <div className={styles.formStack} style={{ marginTop: 16 }}>
          <p className={styles.fieldHelp} style={{ marginBottom: 8 }}>
            Registration flow — saved with Stage 2 settings below.
          </p>
          <label className={styles.toggleCard}>
            <input
              type="radio"
              name="registrationFlowMode"
              checked={registrationFlowMode === 'two_step'}
              onChange={() => setRegistrationFlowMode('two_step')}
            />
            <span>
              <strong>Two-step</strong>
              <span className={styles.toggleCardHint}>
                Account + short form now; full profile later in the portal when Stage 2 is active.
              </span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input
              type="radio"
              name="registrationFlowMode"
              checked={registrationFlowMode === 'one_step'}
              onChange={() => setRegistrationFlowMode('one_step')}
            />
            <span>
              <strong>One-step</strong>
              <span className={styles.toggleCardHint}>
                Account + full registration form on the public link (no holding screen for profile).
              </span>
            </span>
          </label>
        </div>
        <div className={styles.linkCardGrid}>
          {visibleForms.map((form) => {
            const portalAudience =
              form.audience === 'vendor' ? 'vendor' : form.audience === 'user' ? 'speaker' : 'delegate';
            const sameAudienceCount = listManageableForms(forms).filter((f) => f.audience === form.audience).length;
            // Always include slug when multiple tracks exist so each link is unambiguous.
            const linkSlug = sameAudienceCount > 1 ? form.slug : null;
            return (
              <CopyLinkCard
                key={form.id}
                label={`${toDisplayFormName(form)} registration`}
                hint={`${titleizeAudience(form.audience)} · Stage 1${form.slug ? ` · /${form.slug}` : ''}`}
                url={publicRegisterUrl(eventId, portalAudience, linkSlug)}
              />
            );
          })}
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
        {(delegateStage2Active && !savedActivationFlags.delegateStage2) ||
        (vendorStage2Active && !savedActivationFlags.vendorStage2) ? (
          <p className={styles.warnCallout}>
            Warning: Saving will ask whether to email registered users that Registration Details are now open.
          </p>
        ) : null}
        {portalSaveNote ? <p className={styles.saveNote}>{portalSaveNote}</p> : null}
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
          <div className={styles.field}>
            <span>Registration detail body</span>
            <RichTextEditor
              value={stage2HoldingMessage}
              onChange={setStage2HoldingMessage}
              minHeight={140}
              placeholder="Your registration is confirmed! Full profile setup opens soon — we will email you when it is ready."
            />
            <span className={styles.fieldHelp}>
              Always starts with the Registration Details holding text from the portal. Edit as needed — size, color, bold, lists, and links supported.
            </span>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setStage2HoldingMessage(defaultHoldingBodyHtml())}
            >
              Reset to default page text
            </button>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnPrimary} disabled={savingPortalSettings} onClick={() => void savePortalSettings()}>
              {savingPortalSettings ? 'Saving…' : 'Save Stage 2 settings'}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Meeting and hotel portal</h2>
        </div>
        <p className={styles.sectionLead}>
          Control optional menu items for delegate and vendor portals, and who gets notified when someone submits registration.
        </p>
        {meetingRequestsOpen && !savedActivationFlags.meetingRequests ? (
          <p className={styles.warnCallout}>
            Warning: Saving will ask whether to email registered users that Meeting Requests are now open.
          </p>
        ) : null}
        {portalSaveNote ? <p className={styles.saveNote}>{portalSaveNote}</p> : null}
        <div className={styles.formStack}>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={meetingRequestsOpen} onChange={(e) => setMeetingRequestsOpen(e.target.checked)} />
            <span>
              <strong>Meeting requests open</strong>
              <span className={styles.toggleCardHint}>Shows Meeting Requests in the delegate and vendor menus.</span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input
              type="checkbox"
              checked={vendorMatchSuggestionsEnabled}
              onChange={(e) => setVendorMatchSuggestionsEnabled(e.target.checked)}
            />
            <span>
              <strong>Show suggested matches to vendors</strong>
              <span className={styles.toggleCardHint}>
                Off by default. When on, vendors see a Suggested Match column on Meeting Selections, sorted by
                form fit, with the best match marked (not who requested them).
              </span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input
              type="checkbox"
              checked={delegateMatchSuggestionsEnabled}
              onChange={(e) => setDelegateMatchSuggestionsEnabled(e.target.checked)}
            />
            <span>
              <strong>Show suggested matches to delegates</strong>
              <span className={styles.toggleCardHint}>
                Off by default. When on, delegates see a Suggested Match column on Meeting Selections, sorted by
                form fit, with the best match marked.
              </span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input
              type="checkbox"
              checked={portalReceivedRequestsVisible}
              onChange={(e) => setPortalReceivedRequestsVisible(e.target.checked)}
            />
            <span>
              <strong>Show who requested them</strong>
              <span className={styles.toggleCardHint}>
                Off by default. When on, registrants can open Received and see inbound meeting requests.
              </span>
            </span>
          </label>
          <label className={styles.toggleCard}>
            <input type="checkbox" checked={delegateHotelVisible} onChange={(e) => setDelegateHotelVisible(e.target.checked)} />
            <span>
              <strong>Show Hotel tab</strong>
              <span className={styles.toggleCardHint}>Display hotel info in the delegate and vendor portals.</span>
            </span>
          </label>
          <div className={styles.field}>
            <span>Hotel tab content</span>
            <RichTextEditor
              value={delegateHotelContent}
              onChange={setDelegateHotelContent}
              minHeight={140}
              placeholder="Hotel address, included nights, booking link, check-in/out times, confirmation notes…"
            />
            <span className={styles.fieldHelp}>Shown on the Hotel tab for delegates and vendors. Bold, color, lists, and links supported.</span>
          </div>
          <label className={styles.field}>
            <span>Team notification emails</span>
            <input
              value={registrationNotifyTeamEmails}
              onChange={(e) => setRegistrationNotifyTeamEmails(e.target.value)}
              placeholder="ops@example.com, events@example.com"
            />
            <span className={styles.fieldHelp}>Comma-separated. Notified when someone submits registration.</span>
          </label>
          <label className={styles.field}>
            <span>Registration email From address</span>
            <input
              value={registrationFromEmail}
              onChange={(e) => setRegistrationFromEmail(e.target.value)}
              placeholder={'Your Event <your_event@kbmcollective.org>'}
            />
            <span className={styles.fieldHelp}>
              What registrants see in From (must use @kbmcollective.org). Leave blank for the default KBM Connect address.
            </span>
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
        {isStandard ? (
          <p className={styles.sectionLead}>
            Edit the registration questions below. Add, hide, or reorder questions and sections. The website's Register
            button opens this form.
          </p>
        ) : (
          <p className={styles.sectionLead}>
            Create separate tracks for the same audience (e.g. HR Leadership vs Culture &amp; Engagement). Duplicate a
            form to keep shared questions, then rename and edit track-specific ones — or add a form (starts with the
            default questions). Each form gets its own registration link under Portal setup.
          </p>
        )}
        {templateError ? <p className={styles.error}>{templateError}</p> : null}
        <div className={styles.inlineForm}>
          <input
            value={newFormName}
            onChange={(e) => setNewFormName(e.target.value)}
            placeholder="e.g. HR Leadership & Wellness"
          />
          {!isStandard ? (
            <select value={newFormAudience} onChange={(e) => setNewFormAudience(e.target.value as MatchmakingAudience)}>
              <option value="attendee">Delegate</option>
              <option value="vendor">Vendor</option>
            </select>
          ) : null}
          <button type="button" onClick={() => void addForm()} disabled={savingForm}>
            {savingForm ? 'Adding…' : 'Add form'}
          </button>
        </div>
        {formError ? <p className={styles.error}>{formError}</p> : null}
        {forms.length === 0 ? (
          <p className={styles.hint}>No forms yet. Create a delegate or vendor form to begin.</p>
        ) : (
          <div className={styles.formsGrid}>
            {visibleForms.map((form) => (
              <div
                key={form.id}
                className={`${styles.formCard} ${selectedFormId === form.id ? styles.formCardActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.formCardSelect}
                  onClick={() => setSelectedFormId(form.id)}
                >
                  {renamingFormId === form.id ? (
                    <input
                      value={renameFormValue}
                      onChange={(e) => setRenameFormValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void renameForm(form.id);
                        }
                      }}
                      aria-label="Form name"
                    />
                  ) : (
                    <strong>{toDisplayFormName(form)}</strong>
                  )}
                  <span>{titleizeAudience(form.audience)}</span>
                  <span>{form.is_active ? 'Active' : 'Inactive'}</span>
                  {form.slug ? <span className={styles.hint}>/{form.slug}</span> : null}
                </button>
                <div className={styles.formCardActions}>
                  {renamingFormId === form.id ? (
                    <>
                      <button type="button" disabled={savingForm} onClick={() => void renameForm(form.id)}>
                        Save name
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingFormId('');
                          setRenameFormValue('');
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFormId(form.id);
                          setRenamingFormId(form.id);
                          setRenameFormValue(toDisplayFormName(form));
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={duplicatingFormId === form.id}
                        onClick={() => void duplicateForm(form.id)}
                      >
                        {duplicatingFormId === form.id ? 'Copying…' : 'Duplicate'}
                      </button>
                      <button
                        type="button"
                        disabled={deletingFormId === form.id || savingForm}
                        onClick={() => void deleteForm(form.id)}
                      >
                        {deletingFormId === form.id ? 'Removing…' : 'Delete'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Questions {activeForm ? `— ${activeForm.name}` : ''}</h2>
          {activeForm ? (
            <StatusBadge label={titleizeAudience(activeForm.audience)} tone="info" />
          ) : null}
        </div>
        {activeForm ? (
          <p className={styles.sectionLead}>
            Editing the <strong>{titleizeAudience(activeForm.audience)}</strong> form only. New questions appear on
            that registration link alone — select the other form card above to edit Vendor vs Delegate separately.
          </p>
        ) : null}
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
              {hiddenQuestionCount > 0 ? (
                <span className={styles.questionsToolbarLegacy} role="status">
                  {hiddenQuestionCount} hidden — use Show / Show section to unhide
                </span>
              ) : null}
              {activeForm.audience === 'vendor' && delegateFormsForCopy.length > 0 ? (
                <label className={styles.delegateCopySource}>
                  <span className={styles.delegateCopySourceLabel}>Delegate source (Solution interest copy)</span>
                  <select
                    value={delegateCopySourceFormId}
                    onChange={(e) => setDelegateCopySourceFormId(e.target.value)}
                    className={styles.questionsToolbarSelect}
                    aria-label="Delegate form used for section copy"
                  >
                    {delegateFormsForCopy.map((form) => (
                      <option key={form.id} value={form.id}>
                        {toDisplayFormName(form)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!canReorderSections && activeForm ? (
                <span className={styles.questionsToolbarLegacy} role="status">
                  Clear search and show all sections to drag-reorder
                </span>
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
                      const sectionCollapsed = collapsedSections[group.label] !== false;
                      const sectionAllHidden = group.items.length > 0 && group.items.every((q) => q.is_hidden);
                      const showAddForm = addingQuestionToSection === group.label;
                      const sectionDraggable = canDragSection(group.label);
                      const sectionDragOver =
                        dragOverSectionLabel === group.label &&
                        draggingSectionLabel !== '' &&
                        draggingSectionLabel !== group.label;
                      return (
                      <div
                        key={group.label}
                        className={`${styles.sectionBlock} ${sectionDragOver ? styles.sectionBlockDragOver : ''} ${draggingSectionLabel === group.label ? styles.sectionBlockDragging : ''}`}
                        onDragOver={(e) => {
                          if (!canDropOnSection(group.label) || !draggingSectionLabel) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverSectionLabel(group.label);
                        }}
                        onDragLeave={() => {
                          setDragOverSectionLabel((prev) => (prev === group.label ? '' : prev));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromLabel = draggingSectionLabel || e.dataTransfer.getData('text/plain');
                          setDraggingSectionLabel('');
                          setDragOverSectionLabel('');
                          if (fromLabel && fromLabel !== group.label) {
                            void reorderSectionByDrag(fromLabel, group.label);
                          }
                        }}
                      >
                        <div className={styles.sectionHead}>
                          {sectionDraggable ? (
                            <span
                              className={styles.sectionDragHandle}
                              draggable
                              role="button"
                              tabIndex={0}
                              onDragStart={(e) => {
                                setDraggingSectionLabel(group.label);
                                e.dataTransfer.setData('text/plain', group.label);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => {
                                setDraggingSectionLabel('');
                                setDragOverSectionLabel('');
                              }}
                              aria-label={`Drag to reorder ${group.label}`}
                              title="Drag to reorder section"
                            >
                              ⋮⋮
                            </span>
                          ) : (
                            <span className={styles.sectionDragSpacer} aria-hidden />
                          )}
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
                                disabled={
                                  sectionBusy ||
                                  renamingSectionLabel === group.label ||
                                  (sectionContainsBaseQuestions(group.label) && !isPlatformAdmin)
                                }
                                title={
                                  sectionContainsBaseQuestions(group.label) && !isPlatformAdmin
                                    ? 'Only platform admins can rename default sections'
                                    : undefined
                                }
                              >
                                Rename
                              </button>
                            ) : null}
                            {group.items.length > 0 ? (
                              <button
                                type="button"
                                className={sectionAllHidden ? styles.btnPrimary : styles.btnSecondary}
                                onClick={() => { setSectionFromLabel(group.label); void setSectionHidden(group.label, !sectionAllHidden); }}
                                disabled={sectionBusy}
                              >
                                {sectionAllHidden ? 'Show section' : 'Hide section'}
                              </button>
                            ) : null}
                            {group.label !== 'General' && group.items.length > 0 ? (
                              <button
                                type="button"
                                className={styles.btnDangerOutline}
                                onClick={() => { setSectionFromLabel(group.label); void clearSectionQuestions(group.label); }}
                                disabled={sectionBusy}
                                title="Remove all questions in this section but keep the section heading"
                              >
                                Clear section
                              </button>
                            ) : null}
                            {activeForm.audience === 'vendor' &&
                            VENDOR_COPY_FROM_DELEGATE_SECTIONS.has(group.label) &&
                            delegateFormsForCopy.length > 0 ? (
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                onClick={() => void copyVendorSectionFromDelegate(group.label)}
                                disabled={sectionBusy || copyingSectionLabel === group.label}
                                title="Sync matching questions and choices from the selected delegate form"
                              >
                                {copyingSectionLabel === group.label ? 'Copying…' : 'Copy from delegate'}
                              </button>
                            ) : null}
                            {group.label !== 'General' &&
                            (!sectionContainsBaseQuestions(group.label) || isPlatformAdmin) ? (
                              <button
                                type="button"
                                className={styles.btnDangerOutline}
                                onClick={() => { setSectionFromLabel(group.label); void deleteSection(group.label); }}
                                disabled={sectionBusy}
                                title="Delete custom questions, hide defaults, and remove this section"
                              >
                                Delete section
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
                            {group.items.length === 0 ? (
                              <p className={styles.sectionEmptyHint}>
                                No questions yet. Click <strong>+ Add question</strong> — the editor on the right opens so you
                                can add the question and its choices together.
                              </p>
                            ) : null}
                            {group.label === 'Registration' ? (
                              <p className={styles.hint}>
                                These fields appear at the top of the public registration form (name, email, company, cell).
                                Password is created on the form itself and is not a Matchmaking question.
                              </p>
                            ) : null}

                            {group.items.length > 0 ? (
                            <ul className={styles.list}>
                              {group.items.map((q) => {
                                const isSolutionCategoryQ = isSolutionCategoryInterestPrompt(q.prompt);
                                return (
                                <li
                                  key={q.id}
                                  className={`${styles.questionRow} ${isSolutionCategoryQ ? styles.solutionInterestCombinedCard : ''} ${selectedQuestionId === q.id && !addingQuestionToSection ? styles.questionRowSelected : ''} ${q.is_hidden ? styles.questionRowHidden : ''}`}
                                >
                                  <div className={styles.questionRowTop}>
                                    <div className={styles.questionRowMain}>
                                      <button
                                        type="button"
                                        className={styles.qSelectBtn}
                                        onClick={() => {
                                          setAddingQuestionToSection(null);
                                          setSelectedQuestionId(q.id);
                                        }}
                                      >
                                        <strong>{q.prompt}</strong>
                                        <span className={styles.questionMeta}>
                                          <span className={styles.typePill}>{q.question_type}</span>
                                          {q.is_required ? <span className={styles.requiredPill}>Required</span> : null}
                                          {q.is_base_question ? <span className={styles.baseTag}>default</span> : null}
                                          {q.used_in_matching ? <span className={styles.requiredPill}>matching</span> : null}
                                          {q.is_hidden ? <span className={styles.hiddenPill}>Hidden</span> : null}
                                        </span>
                                        {isSolutionCategoryQ ? (
                                          <span className={styles.solutionInterestCombinedHint}>
                                            One form question. Choices below are what registrants can pick. Use{' '}
                                            <strong>Hide section</strong> to remove it from the portal.
                                          </span>
                                        ) : null}
                                      </button>
                                    </div>
                                    <div className={styles.questionRowActions}>
                                      <button
                                        type="button"
                                        className={styles.btnSecondary}
                                        onClick={() => {
                                          setAddingQuestionToSection(null);
                                          setSelectedQuestionId(q.id);
                                        }}
                                      >
                                        {q.is_base_question && !isPlatformAdmin ? 'View' : 'Edit'}
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.btnSecondary}
                                        disabled={Boolean(duplicatingQuestionId)}
                                        onClick={() => void duplicateQuestion(q.id)}
                                      >
                                        {duplicatingQuestionId === q.id ? 'Copying…' : 'Duplicate'}
                                      </button>
                                      <button
                                        type="button"
                                        className={q.is_hidden ? styles.btnPrimary : styles.btnSecondary}
                                        onClick={() => void toggleQuestionHidden(q.id, !Boolean(q.is_hidden))}
                                      >
                                        {q.is_hidden ? 'Show' : 'Hide'}
                                      </button>
                                      <button type="button" className={styles.btnIcon} onClick={() => void moveQuestion(q.id, -1)} aria-label="Move up">↑</button>
                                      <button type="button" className={styles.btnIcon} onClick={() => void moveQuestion(q.id, 1)} aria-label="Move down">↓</button>
                                      {!q.is_base_question || isPlatformAdmin ? (
                                        <button type="button" className={styles.btnDangerOutline} onClick={() => void deleteQuestion(q.id)}>Delete</button>
                                      ) : null}
                                    </div>
                                  </div>
                                  {eventId && isSolutionCategoryQ ? (
                                    <div className={styles.solutionCategoriesPanel}>
                                      <h4 className={styles.solutionCategoriesPanelTitle}>Choices registrants can select</h4>
                                      {q.is_hidden || sectionAllHidden ? (
                                        <p className={styles.hint}>
                                          This question/section is hidden — choices will not appear on the registration form
                                          until you click Show section.
                                        </p>
                                      ) : null}
                                      <MatchmakingSolutionCategories
                                        key={`${eventId}-${activeForm.id}-${categoriesRefreshKey}`}
                                        eventId={eventId}
                                        formId={activeForm.id}
                                        audience={activeForm.audience}
                                        compact
                                      />
                                    </div>
                                  ) : null}
                                </li>
                                );
                              })}
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
                {addingQuestionToSection ? (
                  <div className={`${styles.panel} ${styles.panelAccent}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Add question</span>
                      <span className={styles.panelHint}>{addingQuestionToSection}</span>
                    </div>
                    <div className={styles.panelBody}>
                      <p className={styles.hint}>
                        Saves only on this {activeForm?.audience === 'vendor' ? 'Vendor' : 'Delegate'} form. For multiple
                        choice, add the choices below before you save.
                      </p>
                      <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                          <span>Question text</span>
                          <input
                            value={questionPrompt}
                            onChange={(e) => setQuestionPrompt(e.target.value)}
                            placeholder="e.g. Please list your top 5 priorities for 2026"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && questionType !== 'single_select' && questionType !== 'multi_select') {
                                void addQuestion(addingQuestionToSection);
                              }
                            }}
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Answer type</span>
                          <select
                            value={questionType}
                            onChange={(e) => {
                              const next = e.target.value as MatchmakingQuestionType;
                              setQuestionType(next);
                              if (next !== 'single_select' && next !== 'multi_select') {
                                setDraftOptionLabels([]);
                                setDraftOptionInput('');
                              }
                            }}
                          >
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
                      </div>
                      <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                          <span>Show only when (optional)</span>
                          <select
                            value={questionConditionParentId}
                            onChange={(event) => {
                              setQuestionConditionParentId(event.target.value);
                              setQuestionConditionValue('');
                            }}
                          >
                            <option value="">Always show</option>
                            {conditionalParentOptions(activeQuestions, questionOptions).map((parent) => (
                              <option key={parent.id} value={parent.id}>
                                {parent.prompt}
                              </option>
                            ))}
                          </select>
                        </label>
                        {questionConditionParentId ? (
                          <label className={styles.field}>
                            <span>When answer is</span>
                            <select
                              value={questionConditionValue}
                              onChange={(event) => setQuestionConditionValue(event.target.value)}
                            >
                              <option value="">Choose an answer</option>
                              {conditionChoicesFor(questionConditionParentId).map((choice) => (
                                <option key={choice} value={choice}>
                                  {choice}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {questionType === 'single_select' || questionType === 'multi_select' ? (
                        <div className={`${styles.optionEditor} ${styles.addChoicesBlock}`}>
                          <h4 className={styles.addChoicesTitle}>Answer choices</h4>
                          <p className={styles.hint}>Add every choice here, then click Add question once.</p>
                          <div className={styles.inlineForm}>
                            <input
                              value={draftOptionInput}
                              onChange={(e) => setDraftOptionInput(e.target.value)}
                              placeholder="Add option label"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addDraftOption();
                                }
                              }}
                            />
                            <button type="button" onClick={addDraftOption}>
                              Add option
                            </button>
                          </div>
                          {optionError ? <p className={styles.error}>{optionError}</p> : null}
                          {draftOptionLabels.length === 0 ? (
                            <p className={styles.hint}>No choices yet — add at least one for select questions.</p>
                          ) : (
                            <ul className={styles.optionList}>
                              {draftOptionLabels.map((label, idx) => (
                                <li key={`${label}-${idx}`} className={styles.optionRow}>
                                  <span>{label}</span>
                                  <span className={styles.qMoveBtns}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDraftOptionLabels((prev) => prev.filter((_, i) => i !== idx))
                                      }
                                    >
                                      Remove
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : null}
                      {questionError ? <p className={styles.error}>{questionError}</p> : null}
                      <div className={styles.panelActions}>
                        <button
                          type="button"
                          className={styles.btnPrimary}
                          onClick={() => void addQuestion(addingQuestionToSection)}
                          disabled={savingQuestion}
                        >
                          {savingQuestion ? 'Adding…' : 'Add question'}
                        </button>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={cancelAddQuestionToSection}
                          disabled={savingQuestion}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : !selectedQuestion ? (
                  <div className={`${styles.panel} ${styles.panelMuted}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Question editor</span>
                    </div>
                    <div className={styles.panelBody}>
                      <p className={styles.hint}>
                        Click <strong>+ Add question</strong> on a section, or <strong>Edit</strong> a question. This
                        panel stays on the right while you work.
                      </p>
                    </div>
                  </div>
                ) : null}
                {selectedQuestion && !addingQuestionToSection ? (
                  <div className={`${styles.panel} ${styles.panelAccent}`}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>
                        {canEditSelectedQuestion ? 'Edit selected question' : 'View selected question'}
                      </span>
                      {editFormDirty && canEditSelectedQuestion ? (
                        <span className={styles.unsavedPill} role="status">
                          Unsaved changes — click Save question
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.panelBody}>
                      {!canEditSelectedQuestion ? (
                        <p className={styles.hint}>
                          This is a default question. Event admins can hide/show it and add custom questions; only a
                          platform admin can edit or delete it.
                        </p>
                      ) : null}
                      {selectedQuestionIdentityLocked ? (
                        <p className={styles.hint}>
                          This is a registration identity field (header grid). Question text and answer type are locked
                          so editing cannot overwrite Company Name / name / email. Add a{' '}
                          <strong>new custom question</strong> for event-specific prompts.
                        </p>
                      ) : null}
                      <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                          <span>Question text</span>
                          <input
                            value={editingQuestionPrompt}
                            disabled={!canEditSelectedQuestionPrompt}
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
                            disabled={!canEditSelectedQuestionPrompt}
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
                              disabled={!canEditSelectedQuestion}
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
                                disabled={!canEditSelectedQuestion}
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
                        {isPlatformAdmin ? (
                          <div className={`${styles.field} ${styles.fieldCheckbox}`}>
                            <span>Default status</span>
                            <span className={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={editingQuestionIsDefault}
                                onChange={(e) => {
                                  questionEditTouchedRef.current = true;
                                  setEditingQuestionIsDefault(e.target.checked);
                                }}
                                id="edit-q-default"
                              />
                              <label htmlFor="edit-q-default">
                                Lock as default for event admins (this form only — does not copy to Vendor/Delegate)
                              </label>
                            </span>
                          </div>
                        ) : selectedQuestion.is_base_question ? (
                          <p className={styles.hint}>
                            Default question — hide/show only. Add a custom question for event-specific fields.
                          </p>
                        ) : null}
                        <label className={styles.field}>
                          <span>Quick section</span>
                          <select
                            value={
                              !editingQuestionSectionLabel.trim()
                                ? '__general__'
                                : editingQuestionSectionLabel.trim()
                            }
                            disabled={!canEditSelectedQuestionSection}
                            onChange={(e) => {
                              const v = e.target.value;
                              questionEditTouchedRef.current = true;
                              setEditingQuestionSectionLabel(v === '__general__' ? '' : v);
                            }}
                            aria-label="Apply a preset section"
                          >
                            <option value="__general__">General</option>
                            {addQuestionSectionPickOptions.map((label) => (
                              <option key={label} value={label}>
                                {label}
                              </option>
                            ))}
                            {editingQuestionSectionLabel.trim() &&
                            editingQuestionSectionLabel.trim() !== 'General' &&
                            !addQuestionSectionPickOptions.includes(editingQuestionSectionLabel.trim()) ? (
                              <option value={editingQuestionSectionLabel.trim()}>
                                {editingQuestionSectionLabel.trim()}
                              </option>
                            ) : null}
                          </select>
                          <span className={styles.hint}>Changes the section below — click Save question to apply.</span>
                        </label>
                        <label className={styles.field}>
                          <span>Section label</span>
                          <input
                            value={editingQuestionSectionLabel}
                            disabled={!canEditSelectedQuestionSection}
                            onChange={(e) => {
                              questionEditTouchedRef.current = true;
                              setEditingQuestionSectionLabel(e.target.value);
                            }}
                            placeholder="Section (optional)"
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Show only when (optional)</span>
                          <select
                            value={editingQuestionConditionParentId}
                            disabled={!canEditSelectedQuestion}
                            onChange={(event) => {
                              questionEditTouchedRef.current = true;
                              setEditingQuestionConditionParentId(event.target.value);
                              setEditingQuestionConditionValue('');
                            }}
                          >
                            <option value="">Always show</option>
                            {conditionalParentQuestions.map((parent) => (
                              <option key={parent.id} value={parent.id}>
                                {parent.prompt}
                              </option>
                            ))}
                          </select>
                        </label>
                        {editingQuestionConditionParentId ? (
                          <label className={styles.field}>
                            <span>When answer is</span>
                            <select
                              value={editingQuestionConditionValue}
                              disabled={!canEditSelectedQuestion}
                              onChange={(event) => {
                                questionEditTouchedRef.current = true;
                                setEditingQuestionConditionValue(event.target.value);
                              }}
                            >
                              <option value="">Choose an answer</option>
                              {conditionChoicesFor(editingQuestionConditionParentId).map((choice) => (
                                <option key={choice} value={choice}>
                                  {choice}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {canEditSelectedQuestion ? (
                        <div className={styles.panelActions}>
                          <button type="button" className={styles.btnPrimary} onClick={() => void saveQuestionEdits()} disabled={savingQuestionEdit}>
                            {savingQuestionEdit ? 'Saving…' : 'Save question'}
                          </button>
                        </div>
                      ) : null}
                      {selectedQuestion.question_type === 'single_select' ||
                      selectedQuestion.question_type === 'multi_select' ? (
                        <div className={`${styles.optionEditor} ${styles.addChoicesBlock}`}>
                          <h4 className={styles.addChoicesTitle}>Answer choices</h4>
                          {canEditSelectedQuestion ? (
                            <div className={styles.inlineForm}>
                              <input
                                value={newOptionLabel}
                                onChange={(e) => setNewOptionLabel(e.target.value)}
                                placeholder="Add option label"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void addOptionToSelected();
                                  }
                                }}
                              />
                              <button type="button" onClick={() => void addOptionToSelected()}>
                                Add option
                              </button>
                            </div>
                          ) : (
                            <p className={styles.hint}>Answer choices for default questions are view-only for event admins.</p>
                          )}
                          {optionError ? <p className={styles.error}>{optionError}</p> : null}
                          <ul className={styles.optionList}>
                            {selectedQuestionOptions.map((opt) => (
                              <li key={opt.id} className={styles.optionRow}>
                                {editingOptionId === opt.id && canEditSelectedQuestion ? (
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
                                    {canEditSelectedQuestion ? (
                                      <span className={styles.qMoveBtns}>
                                        <button type="button" onClick={() => void moveOption(opt.id, -1)}>↑</button>
                                        <button type="button" onClick={() => void moveOption(opt.id, 1)}>↓</button>
                                        <button type="button" onClick={() => beginEditOption(opt)}>Edit</button>
                                        <button type="button" onClick={() => void deleteOption(opt.id)}>Delete</button>
                                      </span>
                                    ) : null}
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
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
        <p className={styles.hint}>
          Approve adds them to <strong>Members</strong> so they can use the app. Reject blocks the portal and turns off
          their app membership for this event (account is kept). After Reject, you can <strong>Approve</strong> again to
          restore access.
        </p>
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
          <label className={`${styles.field} ${styles.fieldGrow}`}>
            <span>Search</span>
            <input
              type="search"
              className={styles.searchInput}
              value={registrationSearch}
              onChange={(e) => setRegistrationSearch(e.target.value)}
              placeholder="Name, email, or company…"
              aria-label="Search registrations by name, email, or company"
            />
          </label>
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
            </select>
          </label>
          <label className={styles.field}>
            <span>Form / track</span>
            <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)}>
              <option value="all">All forms</option>
              {registrationFormFilterOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
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
            <strong>{registrationSearch.trim() ? 'No matching registrations' : 'No registrations yet'}</strong>
            <p>
              {registrationSearch.trim()
                ? 'Try another name, email, or company — or clear the search.'
                : 'When delegates and vendors sign up, they will appear here for review.'}
            </p>
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
                  <th>Form / track</th>
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
                    <td>{formNameById.get(row.form_id) ?? '—'}</td>
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
                          {row.registration_status === 'rejected' ? 'Re-approve' : 'Approve'}
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
        {selectedSubmission && activeTab === 'registrations' ? (
          <div
            className={styles.submissionReviewOverlay}
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeSubmissionReview();
            }}
          >
            <div
              ref={submissionReviewRef}
              className={styles.submissionReviewPanel}
              role="dialog"
              aria-modal="true"
              aria-labelledby="submission-review-title"
            >
              <div className={styles.submissionReviewHead}>
                <div>
                  <h3 id="submission-review-title">
                    {[selectedSubmission.first_name, selectedSubmission.last_name].filter(Boolean).join(' ') ||
                      'Registrant'}
                  </h3>
                  <p className={styles.submissionReviewMeta}>
                    {selectedSubmission.email ?? '—'} · {selectedSubmission.company_name ?? '—'} ·{' '}
                    {titleizeAudience(selectedSubmission.attendee_type)}
                    {formNameById.get(selectedSubmission.form_id)
                      ? ` · ${formNameById.get(selectedSubmission.form_id)}`
                      : ''}
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
                      {selectedSubmission.registration_status === 'rejected' ? 'Re-approve' : 'Approve'}
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
                  {['attendee','vendor','delegate'].includes(selectedSubmission.attendee_type) ? (
                    <>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={submissionActionId === selectedSubmission.id}
                        title="Opens their portal in a new tab while you stay signed in as admin"
                        onClick={() => void viewPortalAsMember(selectedSubmission, 'welcome')}
                      >
                        {submissionActionId === selectedSubmission.id ? 'Opening…' : 'View portal as'}
                      </button>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={submissionActionId === selectedSubmission.id}
                        title="Open Registration Details as this person so you can edit their submitted answers"
                        onClick={() => void viewPortalAsMember(selectedSubmission, 'registration')}
                      >
                        Edit registration
                      </button>
                    </>
                  ) : null}
                  {!isStandard ? (
                    <button type="button" className={styles.btnSecondary} onClick={() => goToTab('matching')}>
                      Open approve and schedule
                    </button>
                  ) : null}
                  <button type="button" className={styles.btnSecondary} onClick={closeSubmissionReview}>
                    Close
                  </button>
                </div>
              </div>
              <div className={styles.submissionReviewBody}>
                <section className={styles.submissionReviewHero}>
                  <div className={styles.submissionReviewMediaRow}>
                    <div className={styles.submissionReviewMediaCard}>
                      <span className={styles.submissionReviewFieldLabel}>Profile photo</span>
                      {selectedSubmissionMedia.headshotUrl ? (
                        <div className={styles.submissionReviewMedia}>
                          <img
                            src={selectedSubmissionMedia.headshotUrl}
                            alt="Profile photo"
                            className={styles.submissionReviewHeadshot}
                          />
                          <a
                            href={selectedSubmissionMedia.headshotUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.submissionReviewLink}
                          >
                            Open full size
                          </a>
                        </div>
                      ) : (
                        <span className={styles.submissionReviewFieldValueMuted}>No photo uploaded</span>
                      )}
                    </div>
                    {selectedSubmission.attendee_type === 'vendor' ? (
                      <div className={styles.submissionReviewMediaCard}>
                        <span className={styles.submissionReviewFieldLabel}>Company logo</span>
                        {selectedSubmissionMedia.logoUrl ? (
                          <div className={styles.submissionReviewMedia}>
                            <img
                              src={selectedSubmissionMedia.logoUrl}
                              alt="Company logo"
                              className={styles.submissionReviewLogo}
                            />
                            <a
                              href={selectedSubmissionMedia.logoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.submissionReviewLink}
                            >
                              Open full size
                            </a>
                          </div>
                        ) : (
                          <span className={styles.submissionReviewFieldValueMuted}>No logo uploaded</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.submissionReviewIdentityCard}>
                    <h4>Identity</h4>
                    <div className={styles.submissionReviewGrid}>
                      <div className={styles.submissionReviewField}>
                        <span className={styles.submissionReviewFieldLabel}>Name</span>
                        <span className={styles.submissionReviewFieldValue}>
                          {[selectedSubmission.first_name, selectedSubmission.last_name].filter(Boolean).join(' ') ||
                            '—'}
                        </span>
                      </div>
                      <div className={styles.submissionReviewField}>
                        <span className={styles.submissionReviewFieldLabel}>Email</span>
                        <span className={styles.submissionReviewFieldValue}>
                          {selectedSubmission.email ?? '—'}
                        </span>
                      </div>
                      <div className={styles.submissionReviewField}>
                        <span className={styles.submissionReviewFieldLabel}>Company</span>
                        <span className={styles.submissionReviewFieldValue}>
                          {selectedSubmission.company_name ?? '—'}
                        </span>
                      </div>
                      <div className={styles.submissionReviewField}>
                        <span className={styles.submissionReviewFieldLabel}>Job title</span>
                        <span className={styles.submissionReviewFieldValue}>
                          {selectedSubmission.job_title ?? '—'}
                        </span>
                      </div>
                      {selectedSubmissionPhones.cell ? (
                        <div className={styles.submissionReviewField}>
                          <span className={styles.submissionReviewFieldLabel}>Cell phone</span>
                          <span className={styles.submissionReviewFieldValue}>
                            {selectedSubmissionPhones.cell}
                          </span>
                        </div>
                      ) : null}
                      {selectedSubmissionPhones.work ? (
                        <div className={styles.submissionReviewField}>
                          <span className={styles.submissionReviewFieldLabel}>Work phone</span>
                          <span className={styles.submissionReviewFieldValue}>
                            {selectedSubmissionPhones.work}
                          </span>
                        </div>
                      ) : null}
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
                          className={`${styles.submissionReviewField} ${item.isWide ? styles.submissionReviewFieldWide : ''}`}
                        >
                          <span className={styles.submissionReviewFieldLabel}>
                            {item.question.prompt}
                            {item.question.show_on_profile === false || isRegistrationContactPrompt(item.question.prompt) ? (
                              <span className={styles.privatePill}>Admin only</span>
                            ) : null}
                          </span>
                          {item.isImage ? (
                            <div className={styles.submissionReviewMedia}>
                              <img
                                src={item.displayValue}
                                alt={item.question.prompt}
                                className={
                                  isProfilePhotoRegistrationPrompt(item.question.prompt)
                                    ? styles.submissionReviewHeadshot
                                    : styles.submissionReviewImage
                                }
                              />
                              <a
                                href={item.displayValue}
                                target="_blank"
                                rel="noreferrer"
                                className={styles.submissionReviewLink}
                              >
                                Open full size
                              </a>
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
                          ) : item.logisticsPayload ? (
                            <LogisticsAnswerDisplay payload={item.logisticsPayload} />
                          ) : (
                            <span className={styles.submissionReviewFieldValue}>{item.displayValue}</span>
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
                              <td>{req.reason?.trim() || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!isStandard ? (
                    <p className={styles.hint}>
                      Open{' '}
                      <button type="button" className={styles.tabLink} onClick={() => goToTab('matching')}>
                        Approve and schedule
                      </button>{' '}
                      to compare these with intelligent match suggestions.
                    </p>
                  ) : null}
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {activeTab === 'profiles' ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Profile visibility</h2>
          </div>
          <p className={styles.sectionLead}>
            Choose which registration answers appear when someone opens a profile on Meeting Selections. Unchecked
            answers are still collected and admins always see them under Registrations. Changes apply right away.
          </p>
          {questionError ? <p className={styles.error}>{questionError}</p> : null}
          {visibleForms.length === 0 ? (
            <p className={styles.hint}>No forms yet. Create a delegate or vendor form under Forms &amp; questions.</p>
          ) : (
            <>
              <div className={styles.formsGrid}>
                {visibleForms.map((form) => (
                  <div
                    key={form.id}
                    className={`${styles.formCard} ${activeForm?.id === form.id ? styles.formCardActive : ''}`}
                  >
                    <button type="button" className={styles.formCardSelect} onClick={() => setSelectedFormId(form.id)}>
                      <strong>{toDisplayFormName(form)}</strong>
                      <span>
                        {form.audience === 'vendor'
                          ? 'Vendor form · what delegates see'
                          : 'Delegate form · what vendors see'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
              <p className={styles.hint}>
                Always shown: name, company, job title, and solution categories. Never shown: email, phone, address,
                ZIP, and assistant contact details.
              </p>
              <div className={styles.profileVisibilityStack}>
                {activeSectionGroups.map((group) => {
                  const rows = group.items.filter((q) => {
                    const norm = normalizeRegistrationPrompt(q.prompt);
                    return !REGISTRATION_HEADER_FIELD_PROMPTS.has(norm) && !norm.startsWith('i have read and accept');
                  });
                  if (rows.length === 0) return null;
                  const eligible = rows.filter((q) => !isRegistrationContactPrompt(q.prompt) && !q.is_hidden);
                  const shownCount = eligible.filter((q) => q.show_on_profile !== false).length;
                  const allShown = eligible.length > 0 && shownCount === eligible.length;
                  return (
                    <div key={group.label} className={styles.profileVisibilityCard}>
                      <label className={styles.profileVisibilityHead}>
                        <input
                          type="checkbox"
                          checked={allShown}
                          disabled={eligible.length === 0}
                          onChange={() => void setQuestionsOnProfile(eligible.map((q) => q.id), !allShown)}
                        />
                        <strong>{group.label}</strong>
                        <span className={styles.profileVisibilityCount}>
                          {eligible.length === 0 ? 'Nothing to show' : `${shownCount} of ${eligible.length} shown`}
                        </span>
                      </label>
                      <ul className={styles.profileVisibilityList}>
                        {rows.map((q) => {
                          const contact = isRegistrationContactPrompt(q.prompt);
                          const offForm = Boolean(q.is_hidden);
                          const locked = contact || offForm;
                          return (
                            <li key={q.id}>
                              <label
                                className={`${styles.profileVisibilityRow} ${locked ? styles.profileVisibilityRowLocked : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={!locked && q.show_on_profile !== false}
                                  disabled={locked}
                                  onChange={(e) => void setQuestionsOnProfile([q.id], e.target.checked)}
                                />
                                <span>{q.prompt}</span>
                                {contact ? (
                                  <span className={styles.privatePill}>Contact · never shown</span>
                                ) : offForm ? (
                                  <span className={styles.hiddenPill}>Not on the form</span>
                                ) : null}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ) : null}

      {activeTab === 'slots' ? (
        <div className={styles.tabPanel}>
          <MatchmakingScheduleSetup
            eventId={eventId}
            onDefaultsChange={setAutoSlotDefaults}
            onConfigurationChange={async () => {
              await loadScheduleOptions();
              await load({ silent: true });
            }}
          />
        </div>
      ) : null}

      {activeTab === 'matching' ? (
      <>
      {matchNotice ? <p className={styles.success}>{matchNotice}</p> : null}
      {!scoringSetupApproved ? (
        <div className={styles.calloutWarning} role="status">
          <strong>Intelligent scoring is not set up yet</strong>
          <p>
            Approve the scoring setup below so match scores use your vendor and delegate form
            signals. Until then, scores may be incomplete or based on defaults only.
          </p>
          <div className={styles.calloutActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => {
                document
                  .getElementById('intelligent-scoring-setup')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              Go to scoring setup
            </button>
          </div>
        </div>
      ) : null}
      <MatchmakingVendorMatching
        eventId={eventId}
        eventStartDate={event?.start_date}
        eventEndDate={event?.end_date}
        submissions={submissions}
        meetingRequests={meetingRequests}
        reviews={reviews}
        scheduledMeetings={activeScheduledMeetings}
        timeSlots={scheduleTimeSlots}
        locations={scheduleLocations}
        autoSlotDefaults={autoSlotDefaults}
        onChanged={async () => {
          await load({ silent: true });
          await loadScheduleOptions();
        }}
        onGoToSlots={() => goToTab('slots')}
        onError={(message) => setError(message)}
        onNotice={showMatchNotice}
      />
      <MatchmakingScoringSetup
        eventId={eventId}
        forms={forms}
        questions={questions}
        currentWeights={matchConfig}
        isPlatformAdmin={isPlatformAdmin}
        onApproved={(weights, enabledQuestionIds) => {
          setMatchConfig(weights);
          const enabled = new Set(enabledQuestionIds);
          setQuestions((prev) =>
            prev.map((q) => {
              const form = forms.find((f) => f.id === q.form_id);
              if (!form || (form.audience !== 'vendor' && form.audience !== 'attendee')) return q;
              if (q.is_hidden) return q;
              return { ...q, used_in_matching: enabled.has(q.id) };
            }),
          );
        }}
        onError={(message) => setError(message)}
        onNotice={showMatchNotice}
      />
      </>
      ) : null}

      {activeTab === 'schedule' ? (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Review and publish</h2>
          <StatusBadge
            label={`${activeScheduledMeetings.length} scheduled · ${unscheduledApprovedReviews.length} need a slot`}
            tone="info"
          />
        </div>
        {matchNotice ? <p className={styles.success}>{matchNotice}</p> : null}
        <p className={styles.sectionLead}>
          Pick a day, edit time or table inline, then publish to Meetings / the app.
        </p>
        <MatchmakingScheduleBoard
          eventId={eventId}
          submissions={submissions}
          meetingRequests={meetingRequests}
          unscheduledReviews={unscheduledApprovedReviews}
          scheduledMeetings={activeScheduledMeetings}
          timeSlots={scheduleTimeSlots}
          locations={scheduleLocations}
          locationId={scheduleLocationId}
          onLocationIdChange={setScheduleLocationId}
          actionId={scheduleActionId}
          publishingMeetingId={publishingMeetingId}
          onSchedule={async (review, timeSlotId, locationId) => {
            await scheduleApprovedMatch(review, timeSlotId, locationId);
          }}
          onReschedule={async (meeting, timeSlotId, locationId, notes) => {
            await rescheduleMeeting(meeting, timeSlotId, locationId, notes);
          }}
          onCancel={async (meeting) => {
            await cancelScheduledMeeting(meeting);
          }}
          onPublish={async (meetingId) => {
            await publishMeetingToApp(meetingId);
          }}
          onPublishAll={async (meetingIds) => {
            await publishAllMeetingsToApp(meetingIds);
          }}
          onExportCsv={exportScheduleCsv}
          onGoToMatching={() => goToTab('matching')}
          onChanged={async () => {
            await load({ silent: true });
            await loadScheduleOptions();
          }}
        />
      </section>
      ) : null}
      </div>

      {activationConfirm ? (
        <div
          className={styles.confirmBackdrop}
          role="presentation"
          onClick={() => {
            if (!savingPortalSettings) setActivationConfirm(null);
          }}
        >
          <div
            className={styles.confirmModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="activation-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="activation-confirm-title">Confirm portal activation</h2>
            <p>
              You are turning on: <strong>{activationConfirm.parts.join(', ')}</strong>.
            </p>
            <p>
              This can email{' '}
              <strong>
                {activationConfirm.recipientCount} registered user
                {activationConfirm.recipientCount === 1 ? '' : 's'}
              </strong>
              .
            </p>
            <label className={styles.confirmCheckbox}>
              <input
                type="checkbox"
                checked={activationConfirm.sendEmail}
                onChange={(e) =>
                  setActivationConfirm((prev) =>
                    prev ? { ...prev, sendEmail: e.target.checked } : prev,
                  )
                }
              />
              <span>Send email to registrants</span>
            </label>
            <p className={styles.confirmHint}>
              Uncheck this if you turned something off by mistake and only need to turn it back on without notifying users again.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={savingPortalSettings}
                onClick={() => setActivationConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={savingPortalSettings}
                onClick={() => void confirmActivationSave()}
              >
                {savingPortalSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
