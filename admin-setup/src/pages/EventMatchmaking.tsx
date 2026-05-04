import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  annualRevenue: ['Under 500M', '500M - 1B', '1B - 5B', '5B - 10B', '10B - 20B', '20B+'],
  budget2026: ['Under $100K', '$100K - $250K', '$250K - $500K', '$500K - $1M', '$1M - $5M', '$5M - $10M'],
  scope: ['Regional', 'National', 'Global'],
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
  { prompt: 'Company Name', question_type: 'text', is_required: true, section_label: 'Registration details' },
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
  { prompt: 'Address', question_type: 'text' },
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
  { prompt: 'Name of person I report to', question_type: 'text', is_required: true },
  { prompt: 'Please list your top 5 human resources, total rewards, and corporate wellness priorities for 2026', question_type: 'textarea', section_label: 'Organization context' },
  { prompt: 'Please list your top 5 Culture, Engagement, and DE&I priorities for 2026', question_type: 'textarea' },
  { prompt: 'What challenges are you facing, regarding achieving these objectives?', question_type: 'textarea', is_required: true },
  { prompt: 'Please select the time frame below that best represents the plan to achieve these objectives?', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.timeframe },
  { prompt: 'Total number of employees globally', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.employeeCount },
  { prompt: 'Does your organization provide a tuition assistance benefit?', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'If yes, what amount?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.tuitionAmount },
  { prompt: "How does formal education fit into your organization's culture of learning?", question_type: 'textarea', is_required: true },
  { prompt: 'Which technologies/solutions are you presently utilizing for your human resources and total rewards initiatives?', question_type: 'textarea' },
  { prompt: 'Which technologies or solutions are you currently utilizing for your DE&I and/or Culture & Engagement initiatives?', question_type: 'textarea', is_required: true },
  { prompt: 'Which technologies/solutions are you presently looking to change/upgrade?', question_type: 'textarea', is_required: true },
  { prompt: 'Are you looking to maximize your DE&I strategy with data and analytics?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Are you (or someone who reports to you) responsible for managing your company-wide employee survey program?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'If Yes: When would you be willing to consider a new employee survey partner?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.surveySwitchWindow },
  { prompt: 'Do you or anyone in your department manage compliance requirements for labor law posters, digital postings for remote workers, mandatory employee notifications, and related requirements?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: "Are you responsible for managing your company's rewards and benefits?", question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Are you interested in a solution that makes it easy to create short-form, TikTok-style videos to improve employee experience — from onboarding and training to recognition and employee communication?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Are you a minority owned organization?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
  { prompt: 'Coaching', question_type: 'multi_select', section_label: 'Solution provider categories', options: CATEGORY_OPTIONS.coaching },
  { prompt: 'Consulting & Services', question_type: 'multi_select', options: CATEGORY_OPTIONS.consulting },
  { prompt: 'Culture, Engagement & Wellness', question_type: 'multi_select', options: CATEGORY_OPTIONS.cultureWellness },
  { prompt: 'Technologies', question_type: 'multi_select', options: CATEGORY_OPTIONS.technologies },
  { prompt: 'Training', question_type: 'multi_select', options: CATEGORY_OPTIONS.training },
  { prompt: 'Workforce & Leadership Development', question_type: 'multi_select', options: CATEGORY_OPTIONS.workforceLeadership },
  { prompt: 'Compensation & Benefits', question_type: 'multi_select', options: CATEGORY_OPTIONS.compensationBenefits },
  { prompt: 'Corporate Wellness Services', question_type: 'multi_select', options: CATEGORY_OPTIONS.corporateWellnessServices },
  { prompt: 'Employee Relations', question_type: 'multi_select', options: CATEGORY_OPTIONS.employeeRelations },
  { prompt: 'Executive Training & Leadership Development', question_type: 'multi_select', options: CATEGORY_OPTIONS.executiveLeadership },
  { prompt: 'HR Software & Technologies', question_type: 'multi_select', options: CATEGORY_OPTIONS.hrSoftware },
  { prompt: 'Learning & Development Training & Programs', question_type: 'multi_select', options: CATEGORY_OPTIONS.learningAndDevelopment },
  { prompt: 'Organizational Culture', question_type: 'multi_select', options: CATEGORY_OPTIONS.organizationalCulture },
  { prompt: 'Talent / Human Capital Management (HCM)', question_type: 'multi_select', options: CATEGORY_OPTIONS.talentHcm },
  { prompt: 'Talent Acquisition & Management', question_type: 'multi_select', options: CATEGORY_OPTIONS.talentAcquisition },
  { prompt: 'Other Provider Offerings Not Listed', question_type: 'textarea' },
  { prompt: 'I have read and accept the Terms and Conditions, Code of Conduct & COVID waiver', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
];

const VENDOR_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'Company Name', question_type: 'text', is_required: true, section_label: 'Vendor profile' },
  { prompt: 'Username', question_type: 'text', is_required: true },
  { prompt: 'Address', question_type: 'text' },
  { prompt: 'City', question_type: 'text', is_required: true },
  { prompt: 'State/Province', question_type: 'text', is_required: true },
  { prompt: 'Zip', question_type: 'text' },
  { prompt: 'Country', question_type: 'text' },
  { prompt: 'Company Description', question_type: 'textarea', is_required: true, section_label: 'Marketing profile' },
  { prompt: 'Company Logo Image', question_type: 'text', is_required: true },
  { prompt: 'Company Website', question_type: 'text' },
  { prompt: 'Additional Information PDF URL', question_type: 'text' },
  { prompt: 'Are you a minority owned organization?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Diversity profile' },
  { prompt: 'Specify your minority owned business', question_type: 'text' },
  { prompt: 'Coaching', question_type: 'multi_select', section_label: 'Solution provider categories', options: CATEGORY_OPTIONS.coaching },
  { prompt: 'Consulting & Services', question_type: 'multi_select', options: CATEGORY_OPTIONS.consulting },
  { prompt: 'Culture, Engagement & Wellness', question_type: 'multi_select', options: CATEGORY_OPTIONS.cultureWellness },
  { prompt: 'Technologies', question_type: 'multi_select', options: CATEGORY_OPTIONS.technologies },
  { prompt: 'Training', question_type: 'multi_select', options: CATEGORY_OPTIONS.training },
  { prompt: 'Workforce & Leadership Development', question_type: 'multi_select', options: CATEGORY_OPTIONS.workforceLeadership },
  { prompt: 'Compensation & Benefits', question_type: 'multi_select', options: CATEGORY_OPTIONS.compensationBenefits },
  { prompt: 'Corporate Wellness Services', question_type: 'multi_select', options: CATEGORY_OPTIONS.corporateWellnessServices },
  { prompt: 'Employee Relations', question_type: 'multi_select', options: CATEGORY_OPTIONS.employeeRelations },
  { prompt: 'Executive Training & Leadership Development', question_type: 'multi_select', options: CATEGORY_OPTIONS.executiveLeadership },
  { prompt: 'HR Software & Technologies', question_type: 'multi_select', options: CATEGORY_OPTIONS.hrSoftware },
  { prompt: 'Learning & Development Training & Programs', question_type: 'multi_select', options: CATEGORY_OPTIONS.learningAndDevelopment },
  { prompt: 'Organizational Culture', question_type: 'multi_select', options: CATEGORY_OPTIONS.organizationalCulture },
  { prompt: 'Talent / Human Capital Management (HCM)', question_type: 'multi_select', options: CATEGORY_OPTIONS.talentHcm },
  { prompt: 'Talent Acquisition & Management', question_type: 'multi_select', options: CATEGORY_OPTIONS.talentAcquisition },
  { prompt: 'Other Provider Offerings Not Listed', question_type: 'textarea', section_label: 'Solution provider categories' },
  { prompt: 'Are you sending representatives to the event onsite?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo, section_label: 'Logistics' },
  { prompt: 'Will your team take meetings virtually?', question_type: 'single_select', options: COMMON_SELECT_OPTIONS.yesNo },
];
const SPEAKER_TEMPLATE_QUESTIONS: TemplateQuestion[] = [
  { prompt: 'Company Name', question_type: 'text', is_required: true, section_label: 'Registration details' },
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
  { prompt: 'I have read and accept the Terms and Conditions, Code of Conduct & COVID waiver', question_type: 'single_select', is_required: true, options: COMMON_SELECT_OPTIONS.yesNo },
];
const KBM_ATTENDEE_FORM_NAME = 'KBM Attendee Registration';
const KBM_VENDOR_FORM_NAME = 'KBM Vendor Registration';
const SPEAKER_FORM_NAME = 'Speaker Registration';
const VENDOR_DEPRECATED_PROMPTS = [
  'Are you attending the event?',
  'Use Availability',
  'Number Diaries (maximum meetings per slot)',
  'Maximum Meetings',
  'Max Reps',
  'Max Hotel Days',
  "Available for 1-on-1's",
  'Approved status (Y/N/P)',
  'Company Logo URL',
];

function titleizeAudience(audience: MatchmakingAudience) {
  if (audience === 'user') return 'Speaker';
  if (audience === 'vendor') return 'Vendor';
  return 'Attendee';
}

function toDisplayFormName(form: EventRegistrationForm) {
  if (form.audience === 'attendee') return 'Attendee Registration';
  if (form.audience === 'vendor') return 'Vendor Registration';
  if (form.audience === 'user') return 'Speaker Registration';
  return form.name;
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

export default function EventMatchmaking() {
  const { eventId } = useParams<{ eventId: string }>();
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
  const [savingSettings, setSavingSettings] = useState(false);

  const [newFormName, setNewFormName] = useState('');
  const [newFormAudience, setNewFormAudience] = useState<MatchmakingAudience>('attendee');
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState('');

  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionType, setQuestionType] = useState<MatchmakingQuestionType>('text');
  const [questionRequired, setQuestionRequired] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [optionError, setOptionError] = useState('');
  const [subFilter, setSubFilter] = useState<'all' | 'submitted' | 'draft'>('all');
  const [audienceFilter, setAudienceFilter] = useState<'all' | MatchmakingAudience>('all');
  const [ensuringDefaults, setEnsuringDefaults] = useState(false);
  const [didInitialDefaultSync, setDidInitialDefaultSync] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [scheduleLocation, setScheduleLocation] = useState('');

  const visibleForms = useMemo(() => toPrimaryForms(forms), [forms]);
  const activeForm = useMemo(
    () => visibleForms.find((f) => f.id === selectedFormId) ?? visibleForms[0] ?? null,
    [visibleForms, selectedFormId]
  );

  const activeQuestions = useMemo(
    () => questions.filter((q) => q.form_id === activeForm?.id).sort((a, b) => a.sort_order - b.sort_order),
    [questions, activeForm]
  );
  const selectedQuestion = useMemo(() => questions.find((q) => q.id === selectedQuestionId) ?? null, [questions, selectedQuestionId]);
  const selectedQuestionOptions = useMemo(
    () =>
      questionOptions
        .filter((opt) => opt.question_id === selectedQuestionId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questionOptions, selectedQuestionId]
  );
  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((row) => {
        if (subFilter !== 'all' && row.status !== subFilter) return false;
        if (audienceFilter !== 'all' && row.attendee_type !== audienceFilter) return false;
        return true;
      }),
    [submissions, subFilter, audienceFilter]
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
    () => meetingRequests.filter((r) => r.submission_id === selectedSubmissionId),
    [meetingRequests, selectedSubmissionId]
  );
  const questionById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const suggestedMatches = useMemo(() => {
    if (!selectedSubmission) return [];
    const targetAudience: MatchmakingAudience = selectedSubmission.attendee_type === 'vendor' ? 'attendee' : 'vendor';
    const selectedAnswers = answers.filter((a) => a.submission_id === selectedSubmission.id);
    const selectedSignals = new Set<string>();
    selectedAnswers.forEach((ans) => {
      const q = questionById.get(ans.question_id);
      if (!q) return;
      const isCategory = ['Coaching', 'Consulting & Services', 'Culture, Engagement & Wellness', 'Technologies', 'Training', 'Workforce & Leadership Development', 'Compensation & Benefits', 'Corporate Wellness Services', 'Employee Relations', 'Executive Training & Leadership Development', 'HR Software & Technologies', 'Learning & Development Training & Programs', 'Organizational Culture', 'Talent / Human Capital Management (HCM)', 'Talent Acquisition & Management'].includes(q.prompt);
      if (!isCategory) return;
      if (Array.isArray(ans.answer_json)) {
        (ans.answer_json as string[]).forEach((x) => selectedSignals.add(String(x).toLowerCase()));
      } else if (ans.answer_text) {
        ans.answer_text
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
          .forEach((x) => selectedSignals.add(x));
      }
    });
    const candidates = submissions.filter((s) => s.attendee_type === targetAudience && s.id !== selectedSubmission.id);
    return candidates
      .map((cand) => {
        const candAnswers = answers.filter((a) => a.submission_id === cand.id);
        const candSignals = new Set<string>();
        candAnswers.forEach((ans) => {
          if (Array.isArray(ans.answer_json)) {
            (ans.answer_json as string[]).forEach((x) => candSignals.add(String(x).toLowerCase()));
          } else if (ans.answer_text) {
            ans.answer_text
              .split(',')
              .map((x) => x.trim().toLowerCase())
              .filter(Boolean)
              .forEach((x) => candSignals.add(x));
          }
        });
        let overlap = 0;
        selectedSignals.forEach((sig) => {
          if (candSignals.has(sig)) overlap += 1;
        });
        const textBoost =
          selectedSubmissionRequests.some((r) => (r.target_company_name ?? '').toLowerCase() === (cand.company_name ?? '').toLowerCase()) ? 2 : 0;
        const existingReview = reviews.find(
          (r) =>
            r.from_submission_id === selectedSubmission.id &&
            r.to_submission_id === cand.id
        );
        return { candidate: cand, score: overlap + textBoost, overlap, review: existingReview ?? null };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [selectedSubmission, submissions, answers, questionById, selectedSubmissionRequests, reviews]);

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const { data: ev, error: evErr } = await supabase.from('events').select('id, name').eq('id', eventId).single();
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
          .select('registration_open')
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

  const addQuestion = async () => {
    if (!selectedFormId) return;
    const prompt = questionPrompt.trim();
    if (!prompt) {
      setQuestionError('Question prompt is required.');
      return;
    }
    setSavingQuestion(true);
    setQuestionError('');
    try {
      const formQuestions = questions.filter((q) => q.form_id === selectedFormId);
      const nextSort = formQuestions.length > 0 ? Math.max(...formQuestions.map((q) => q.sort_order)) + 1 : 0;
      const { data, error: insErr } = await supabase
        .from('event_registration_questions')
        .insert({
          form_id: selectedFormId,
          prompt,
          question_type: questionType,
          is_required: questionRequired,
          is_base_question: false,
          sort_order: nextSort,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      setQuestions((prev) => [...prev, data as EventRegistrationQuestion]);
      setSelectedQuestionId((data as EventRegistrationQuestion).id);
      setQuestionPrompt('');
      setQuestionType('text');
      setQuestionRequired(false);
    } catch (e) {
      setQuestionError(postgrestErrorMessage(e) || 'Could not add question');
    } finally {
      setSavingQuestion(false);
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

  const setReviewStatus = async (toSubmissionId: string, score: number, status: 'approved' | 'rejected') => {
    if (!eventId || !selectedSubmission) return;
    try {
      const { error: upsertErr } = await supabase.from('event_match_reviews').upsert({
        event_id: eventId,
        from_submission_id: selectedSubmission.id,
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
            })
            .select('*')
            .single();
          if (formInsertErr) throw formInsertErr;
          form = createdForm as EventRegistrationForm;
          workingForms = [...workingForms, form];
        }

        const existingQuestions = questions.filter((q) => q.form_id === form.id);
        const existingByPrompt = new Map(existingQuestions.map((q) => [q.prompt.trim().toLowerCase(), q]));

        for (const [idx, q] of templateQuestions.entries()) {
          const existing = existingByPrompt.get(q.prompt.trim().toLowerCase());
          if (existing) {
            // Keep base template questions aligned with KBM wording/type/required flags.
            const { error: patchErr } = await supabase
              .from('event_registration_questions')
              .update({
                question_type: q.question_type,
                is_required: q.is_required ?? false,
                section_label: q.section_label ?? null,
                is_base_question: true,
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
              section_label: q.section_label ?? null,
              is_base_question: true,
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

        if (audience === 'vendor') {
          const deprecatedPromptSet = new Set(VENDOR_DEPRECATED_PROMPTS.map((p) => p.trim().toLowerCase()));
          const toHide = existingQuestions.filter((q) => deprecatedPromptSet.has(q.prompt.trim().toLowerCase()) && !q.is_hidden);
          for (const q of toHide) {
            const { error: hideErr } = await supabase.from('event_registration_questions').update({ is_hidden: true }).eq('id', q.id);
            if (hideErr) throw hideErr;
          }
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
          Phase 1 foundations: build attendee/vendor registration forms, capture signups, and prep meeting request data.
        </p>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2>Registration portal</h2>
        <p className={styles.hint}>
          Share links with attendees/vendors/speakers. Toggle registration access per event.
        </p>
        <div className={styles.inlineForm}>
          <label className={styles.checkboxInline}>
            <input
              type="checkbox"
              checked={registrationOpen}
              onChange={(e) => void saveSettings(e.target.checked)}
              disabled={savingSettings}
            />
            Registration open
          </label>
          <code>{`${window.location.origin}/register/${eventId}/attendee`}</code>
          <code>{`${window.location.origin}/register/${eventId}/vendor`}</code>
          <code>{`${window.location.origin}/register/${eventId}/speaker`}</code>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Registration forms</h2>
        <p className={styles.hint}>
          Attendee/vendor/speaker templates are applied by default. Event admins can add custom questions and hide non-needed
          base questions per event.
        </p>
        {templateError ? <p className={styles.error}>{templateError}</p> : null}
        <div className={styles.inlineForm}>
          <input
            value={newFormName}
            onChange={(e) => setNewFormName(e.target.value)}
            placeholder="e.g. Vendor onboarding"
          />
          <select value={newFormAudience} onChange={(e) => setNewFormAudience(e.target.value as MatchmakingAudience)}>
            <option value="attendee">Attendee</option>
            <option value="vendor">Vendor</option>
            <option value="user">Speaker</option>
          </select>
          <button type="button" onClick={() => void addForm()} disabled={savingForm}>
            {savingForm ? 'Adding…' : 'Add form'}
          </button>
        </div>
        {formError ? <p className={styles.error}>{formError}</p> : null}
        {forms.length === 0 ? (
          <p className={styles.hint}>No forms yet. Create an attendee/vendor/speaker form to begin.</p>
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
        <h2>Questions {activeForm ? `— ${activeForm.name}` : ''}</h2>
        {!activeForm ? (
          <p className={styles.hint}>Select a form to add questions.</p>
        ) : (
          <>
            <div className={styles.inlineForm}>
              <input
                value={questionPrompt}
                onChange={(e) => setQuestionPrompt(e.target.value)}
                placeholder="e.g. Please list your top 5 priorities for 2026"
              />
              <select value={questionType} onChange={(e) => setQuestionType(e.target.value as MatchmakingQuestionType)}>
                {QUESTION_TYPE_OPTIONS.map((qt) => (
                  <option value={qt} key={qt}>
                    {qt}
                  </option>
                ))}
              </select>
              <label className={styles.checkboxInline}>
                <input
                  type="checkbox"
                  checked={questionRequired}
                  onChange={(e) => setQuestionRequired(e.target.checked)}
                />
                Required
              </label>
              <button type="button" onClick={() => void addQuestion()} disabled={savingQuestion}>
                {savingQuestion ? 'Adding…' : 'Add question'}
              </button>
            </div>
            {questionError ? <p className={styles.error}>{questionError}</p> : null}
            {activeQuestions.length === 0 ? (
              <p className={styles.hint}>No questions yet for this form.</p>
            ) : (
              <ul className={styles.list}>
                {activeQuestions.map((q) => (
                  <li key={q.id}>
                    <button type="button" className={styles.qSelectBtn} onClick={() => setSelectedQuestionId(q.id)}>
                      <strong>{q.prompt}</strong>{' '}
                      <span>({q.question_type})</span>{' '}
                      {q.is_required ? <em>required</em> : null}
                      {q.is_base_question ? <em className={styles.baseTag}>base</em> : null}
                    </button>
                    <span className={styles.qMoveBtns}>
                      <button type="button" onClick={() => void toggleQuestionHidden(q.id, !Boolean(q.is_hidden))}>
                        {q.is_hidden ? 'Show' : 'Hide'}
                      </button>
                      <button type="button" onClick={() => void moveQuestion(q.id, -1)}>↑</button>
                      <button type="button" onClick={() => void moveQuestion(q.id, 1)}>↓</button>
                      {!q.is_base_question ? (
                        <button type="button" onClick={() => void deleteQuestion(q.id)}>Delete</button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {selectedQuestion && (selectedQuestion.question_type === 'single_select' || selectedQuestion.question_type === 'multi_select') ? (
              <div className={styles.optionEditor}>
                <h3>Options — {selectedQuestion.prompt}</h3>
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
                    <li key={opt.id}>{opt.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>Recent registrations</h2>
        <div className={styles.inlineForm}>
          <select value={subFilter} onChange={(e) => setSubFilter(e.target.value as 'all' | 'submitted' | 'draft')}>
            <option value="all">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="draft">Draft</option>
          </select>
          <select value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as 'all' | MatchmakingAudience)}>
            <option value="all">All audiences</option>
            <option value="attendee">Attendee</option>
            <option value="vendor">Vendor</option>
            <option value="user">Speaker</option>
          </select>
          <button type="button" onClick={exportSubmissionsCsv}>Export CSV</button>
        </div>
        {filteredSubmissions.length === 0 ? (
          <p className={styles.hint}>No registrations yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedSubmissionId === row.id ? styles.rowActive : undefined}
                    onClick={() => setSelectedSubmissionId(row.id)}
                  >
                    <td>{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td>{row.company_name ?? '—'}</td>
                    <td>{row.email ?? '—'}</td>
                    <td>{titleizeAudience(row.attendee_type)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Participant detail + suggested matches</h2>
        {!selectedSubmission ? (
          <p className={styles.hint}>Select a registrant from the table above to view answers and top match suggestions.</p>
        ) : (
          <div className={styles.detailGrid}>
            <div>
              <h3>
                {[selectedSubmission.first_name, selectedSubmission.last_name].filter(Boolean).join(' ') || 'Registrant'}
              </h3>
              <p className={styles.hint}>
                {selectedSubmission.company_name ?? '—'} · {titleizeAudience(selectedSubmission.attendee_type)} ·{' '}
                {selectedSubmission.status}
              </p>
              <h4>Requested meetings</h4>
              {selectedSubmissionRequests.length === 0 ? (
                <p className={styles.hint}>No requested companies/people.</p>
              ) : (
                <ul className={styles.optionList}>
                  {selectedSubmissionRequests.map((req) => (
                    <li key={req.id}>
                      {req.target_company_name || '—'} {req.target_person_name ? `· ${req.target_person_name}` : ''}{' '}
                      {req.reason ? `— ${req.reason}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <h4>Answers</h4>
              <ul className={styles.optionList}>
                {selectedSubmissionAnswers.map((ans) => {
                  const q = questionById.get(ans.question_id);
                  const val = Array.isArray(ans.answer_json)
                    ? (ans.answer_json as string[]).join(', ')
                    : ans.answer_text ?? (ans.answer_boolean === null ? '' : ans.answer_boolean ? 'Yes' : 'No');
                  return (
                    <li key={ans.id}>
                      <strong>{q?.prompt ?? ans.question_id}:</strong> {val || '—'}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3>Top ranked suggestions</h3>
              {suggestedMatches.length === 0 ? (
                <p className={styles.hint}>No compatible matches yet.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Score</th>
                        <th>Overlap</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestedMatches.map((item) => (
                        <tr key={item.candidate.id}>
                          <td>{[item.candidate.first_name, item.candidate.last_name].filter(Boolean).join(' ') || '—'}</td>
                          <td>{item.candidate.company_name ?? '—'}</td>
                          <td>{item.score}</td>
                          <td>{item.overlap}</td>
                          <td>
                            <div className={styles.actionRow}>
                              <button type="button" onClick={() => void setReviewStatus(item.candidate.id, item.score, 'approved')}>
                                Approve
                              </button>
                              <button type="button" onClick={() => void setReviewStatus(item.candidate.id, item.score, 'rejected')}>
                                Reject
                              </button>
                              <span>{item.review?.status ?? 'pending'}</span>
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
        )}
      </section>

      <section className={styles.section}>
        <h2>Admin review queue</h2>
        {reviews.length === 0 ? (
          <p className={styles.hint}>No reviewed matches yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const from = submissions.find((s) => s.id === r.from_submission_id);
                  const to = submissions.find((s) => s.id === r.to_submission_id);
                  return (
                    <tr key={r.id}>
                      <td>{[from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.email || '—'}</td>
                      <td>{[to?.first_name, to?.last_name].filter(Boolean).join(' ') || to?.email || '—'}</td>
                      <td>{r.score}</td>
                      <td>{r.status}</td>
                      <td>{new Date(r.updated_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Scheduling board</h2>
        <p className={styles.hint}>Set slot time, approve matches, and assign meetings with conflict checks.</p>
        <div className={styles.inlineForm}>
          <label>
            Start
            <input type="datetime-local" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} />
          </label>
          <label>
            End
            <input type="datetime-local" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} />
          </label>
          <label>
            Location
            <input value={scheduleLocation} onChange={(e) => setScheduleLocation(e.target.value)} placeholder="Table A1" />
          </label>
        </div>
        <h3>Approved matches ready to schedule</h3>
        {reviews.filter((r) => r.status === 'approved').length === 0 ? (
          <p className={styles.hint}>No approved matches yet.</p>
        ) : (
          <ul className={styles.optionList}>
            {reviews
              .filter((r) => r.status === 'approved')
              .map((r) => {
                const from = submissions.find((s) => s.id === r.from_submission_id);
                const to = submissions.find((s) => s.id === r.to_submission_id);
                return (
                  <li key={r.id}>
                    {[from?.first_name, from?.last_name].filter(Boolean).join(' ') || '—'} ↔{' '}
                    {[to?.first_name, to?.last_name].filter(Boolean).join(' ') || '—'} (score {r.score}){' '}
                    <button type="button" onClick={() => void scheduleApprovedMatch(r)}>
                      Schedule
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
        <div className={styles.inlineForm}>
          <button type="button" onClick={exportScheduleCsv}>Export schedule CSV</button>
        </div>
        {scheduledMeetings.length === 0 ? (
          <p className={styles.hint}>No scheduled meetings yet.</p>
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
                </tr>
              </thead>
              <tbody>
                {scheduledMeetings.map((m) => {
                  const a = submissions.find((s) => s.id === m.submission_a_id);
                  const b = submissions.find((s) => s.id === m.submission_b_id);
                  return (
                    <tr key={m.id}>
                      <td>{[a?.first_name, a?.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td>{[b?.first_name, b?.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td>{new Date(m.start_time).toLocaleString()}</td>
                      <td>{new Date(m.end_time).toLocaleString()}</td>
                      <td>{m.location ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
