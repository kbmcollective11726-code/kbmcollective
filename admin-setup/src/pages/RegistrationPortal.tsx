import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { uploadEventImage } from '../lib/uploadEventImage';
import type {
  Event,
  EventRegistrationForm,
  EventRegistrationQuestion,
  EventRegistrationQuestionOption,
  MatchmakingAudience,
} from '../lib/types';
import { ensureRegistrationAccount } from '../lib/registrationAccount';
import {
  findRegistrationHeadshotUrl,
  isProfilePhotoRegistrationPrompt,
  isUsableProfilePhotoUrl,
  syncUserAvatarFromUrl,
} from '../lib/registrationHeadshot';
import { syncSubmissionSolutionCategories } from '../lib/syncSolutionCategories';
import { publicPortalLoginUrl } from '../lib/publicPortalUrl';
import { formatEventDateRange } from '../lib/registrantPortal';
import {
  isStage1RegistrationQuestion,
  normalizeRegistrationPrompt,
  REGISTRATION_HEADER_FIELD_PROMPTS,
  TERMS_ACCEPTANCE_PROMPT,
} from '../lib/registrationDefaultVisibility';
import { filterRegistrationDetailsQuestions } from '../lib/portalRegistrationDetailsQuestions';
import {
  contactFieldsComplete,
  identityFromAnswers,
  identityFromSubmission,
  requiredQuestionsComplete,
} from '../lib/registrationIdentitySync';
import type { RegistrationFlowMode } from '../lib/registrantPortal';
import { isLegacyImportedFormName } from '../lib/legacyImportedFormName';
import { isSolutionCategoryInterestPrompt } from '../lib/specRegistrationQuestions';
import { groupQuestionsBySection } from '../lib/registrationSectionLabels';
import { mergeSectionOrder } from '../lib/registrationSectionOrder';
import { isRegistrationQuestionVisible } from '../lib/registrationQuestionConditions';
import PortalEventSummary from '../components/PortalEventSummary';
import PortalGuestNav from '../components/PortalGuestNav';
import PortalPublicShell from '../components/PortalPublicShell';
import portalStyles from './delegate-portal/DelegatePortal.module.css';
import styles from './RegistrationPortal.module.css';

type AnswerMap = Record<string, string | string[] | boolean>;
type VendorRepresentative = {
  firstName: string;
  lastName: string;
  title: string;
  workPhone: string;
  cell: string;
  email: string;
};
const KBM_ATTENDEE_FORM_NAME = 'KBM Attendee Registration';
const KBM_VENDOR_FORM_NAME = 'KBM Vendor Registration';

/** Public title for a track form — uses renamed name when set. */
function displayRegistrationFormTitle(
  form: EventRegistrationForm | null,
  audience: MatchmakingAudience | 'speaker' | undefined,
): string {
  const custom = (form?.name ?? '').trim();
  if (custom && custom !== KBM_ATTENDEE_FORM_NAME && custom !== KBM_VENDOR_FORM_NAME) {
    return custom;
  }
  if (audience === 'vendor' || form?.audience === 'vendor') return 'Vendor Registration';
  if (audience === 'speaker' || form?.audience === 'user') return 'Speaker Registration';
  return 'Delegate Registration';
}

const COMPANY_DESCRIPTION_PROMPT = 'Company Description';
const COMPANY_DESCRIPTION_MAX = 2000;
const ADDITIONAL_INFO_PROMPT = 'Additional Information PDF URL';
const MINORITY_OWNED_PROMPT = 'Are you a minority owned organization?';
const MINORITY_SPECIFY_PROMPT = 'Specify your minority owned business';
const LOGISTICS_ATTENDING_PROMPT = 'Are you sending representatives to the event onsite?';
const LOGISTICS_VIRTUAL_PROMPT = 'Will your team take meetings virtually?';
const LEGACY_ATTENDING_PROMPT = 'Are you attending the event?';
const VENDOR_DEPRECATED_OPERATIONS_PROMPTS = new Set([
  'Use Availability',
  'Number Diaries (maximum meetings per slot)',
  'Maximum Meetings',
  'Max Reps',
  'Max Hotel Days',
  "Available for 1-on-1's",
  'Approved status (Y/N/P)',
].map((x) => x.toLowerCase()));
type PublicEventInfo = Pick<
  Event,
  | 'id'
  | 'name'
  | 'description'
  | 'location'
  | 'venue'
  | 'start_date'
  | 'end_date'
  | 'banner_url'
  | 'logo_url'
  | 'badge_banner_url'
  | 'portal_banner_url'
  | 'welcome_title'
  | 'welcome_subtitle'
  | 'welcome_message'
>;

const validAudience = (value: string | undefined): value is MatchmakingAudience | 'speaker' =>
  value === 'attendee' || value === 'delegate' || value === 'vendor' || value === 'user' || value === 'speaker';

const resolveAudience = (value: string | undefined): MatchmakingAudience =>
  value === 'speaker' ? 'user' : value === 'delegate' ? 'attendee' : value === 'attendee' || value === 'vendor' || value === 'user' ? value : 'attendee';

export default function RegistrationPortal() {
  const params = useParams<{
    eventId?: string;
    audience?: string;
    formSlug?: string;
    slug?: string;
  }>();
  /** /e/:slug/register — Standard registration; never reads Matchmaking settings. */
  const siteSlug = (params.slug ?? '').trim();
  const standardMode = Boolean(siteSlug);
  const [siteEventId, setSiteEventId] = useState('');
  const eventId = params.eventId ?? (siteEventId || undefined);
  const audience = standardMode ? 'delegate' : params.audience;
  const formSlug = params.formSlug;
  const [eventInfo, setEventInfo] = useState<PublicEventInfo | null>(null);
  const [form, setForm] = useState<EventRegistrationForm | null>(null);
  const [questions, setQuestions] = useState<EventRegistrationQuestion[]>([]);
  const [options, setOptions] = useState<EventRegistrationQuestionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [registrationFlowMode, setRegistrationFlowMode] = useState<RegistrationFlowMode>('two_step');
  const [uploadingQuestionId, setUploadingQuestionId] = useState('');
  const [solutionCategories, setSolutionCategories] = useState<string[]>([]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [representatives, setRepresentatives] = useState<VendorRepresentative[]>([
    { firstName: '', lastName: '', title: '', workPhone: '', cell: '', email: '' },
  ]);
  const [vendorVirtualFallback, setVendorVirtualFallback] = useState('');
  const [meetingTargets, setMeetingTargets] = useState<Array<{ company: string; person: string; reason: string }>>([{ company: '', person: '', reason: '' }]);
  /** Image files chosen before sign-in (headshot/logo) — uploaded after account creation on submit. */
  const pendingImageFilesRef = useRef<
    Record<string, { file: File; folder: 'registration-headshots' | 'vendor-logos' }>
  >({});
  const statusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!success && !error) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [success, error]);

  useEffect(() => {
    if (!standardMode) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: siteData, error: siteErr } = await supabase.rpc('get_public_event_site', { p_slug: siteSlug });
        if (siteErr) throw siteErr;
        const site = siteData as {
          status?: string;
          event?: { id?: string; name?: string };
          registration_open?: boolean;
          form_id?: string | null;
        } | null;
        if (!site?.event?.id) {
          throw new Error("We couldn't find this registration page. Check the link with the event organizer.");
        }
        if (site.status === 'off') {
          throw new Error(`Registration for ${site.event.name ?? 'this event'} isn't open yet. Check back soon.`);
        }
        if (site.status === 'inactive') {
          throw new Error(`Registration for ${site.event.name ?? 'this event'} is no longer available.`);
        }
        if (cancelled) return;
        setSiteEventId(site.event.id);
        setRegistrationFlowMode('one_step');
        setRegistrationOpen(Boolean(site.registration_open));

        const { data: eventRow } = await supabase
          .from('events')
          .select(
            'id, name, description, location, venue, start_date, end_date, banner_url, logo_url, badge_banner_url, portal_banner_url, welcome_title, welcome_subtitle, welcome_message',
          )
          .eq('id', site.event.id)
          .maybeSingle();
        if (!cancelled) setEventInfo((eventRow as PublicEventInfo | null) ?? null);

        if (!site.registration_open || !site.form_id) {
          throw new Error('Registration is currently closed for this event. Please contact the event organizer.');
        }
        const { data: formRow, error: formErr } = await supabase
          .from('event_registration_forms')
          .select('*')
          .eq('id', site.form_id)
          .maybeSingle();
        if (formErr) throw formErr;
        if (!formRow) throw new Error('Registration form not found. Please contact the event organizer.');
        if (cancelled) return;
        setForm(formRow as EventRegistrationForm);

        const { data: questionRows, error: questionErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .eq('form_id', site.form_id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (questionErr) throw questionErr;
        const qList = (questionRows as EventRegistrationQuestion[]) ?? [];
        if (cancelled) return;
        setQuestions(qList);
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
          if (!cancelled) setOptions((optionRows as EventRegistrationQuestionOption[]) ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load registration form');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [standardMode, siteSlug]);

  useEffect(() => {
    if (standardMode) return;
    if (!eventId || !validAudience(audience)) {
      setError('Invalid registration link.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: eventRow } = await supabase
          .from('events')
          .select(
            'id, name, description, location, venue, start_date, end_date, banner_url, logo_url, badge_banner_url, portal_banner_url, welcome_title, welcome_subtitle, welcome_message',
          )
          .eq('id', eventId)
          .maybeSingle();
        if (!cancelled) setEventInfo((eventRow as PublicEventInfo | null) ?? null);

        const { data: settingsRow, error: settingsErr } = await supabase
          .from('event_matchmaking_settings')
          .select('registration_open, registration_flow_mode')
          .eq('event_id', eventId)
          .maybeSingle();
        if (settingsErr) throw settingsErr;
        const isOpen = Boolean((settingsRow as { registration_open?: boolean } | null)?.registration_open);
        if (!cancelled) setRegistrationOpen(isOpen);
        if (!cancelled) {
          setRegistrationFlowMode(
            (settingsRow as { registration_flow_mode?: string } | null)?.registration_flow_mode === 'one_step'
              ? 'one_step'
              : 'two_step',
          );
        }
        if (!isOpen) {
          throw new Error('Registration is currently closed for this event. Please contact the event admin.');
        }

        const dbAudience = resolveAudience(audience);
        const { data: formRows, error: formErr } = await supabase
          .from('event_registration_forms')
          .select('*')
          .eq('event_id', eventId)
          .eq('audience', dbAudience)
          .eq('is_active', true)
          .eq('is_standard', false)
          .order('sort_order', { ascending: true });
        if (formErr) throw formErr;
        const matchingForms = ((formRows as EventRegistrationForm[]) ?? []).slice().sort((a, b) => {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return (a.name ?? '').localeCompare(b.name ?? '');
        });
        const wantedSlug = (formSlug ?? '').trim().toLowerCase();
        const canonicalName =
          dbAudience === 'attendee'
            ? KBM_ATTENDEE_FORM_NAME
            : dbAudience === 'vendor'
              ? KBM_VENDOR_FORM_NAME
              : 'Speaker Registration';
        const formRow = wantedSlug
          ? matchingForms.find((f) => (f.slug ?? '').trim().toLowerCase() === wantedSlug) ??
            matchingForms.find((f) => f.id.toLowerCase() === wantedSlug) ??
            null
          : matchingForms.find((f) => canonicalName && f.name === canonicalName) ??
            matchingForms.find((f) => !isLegacyImportedFormName(f.name)) ??
            matchingForms[0] ??
            null;
        if (!formRow) {
          throw new Error(
            wantedSlug
              ? `Registration form "${formSlug}" was not found for this event. Check the link with the event admin.`
              : `Registration is not available for ${audience} yet. Ask the event admin to turn on "Registration open" and keep the ${audience} form active in Matchmaking setup.`,
          );
        }
        const selectedForm = formRow as EventRegistrationForm;
        if (cancelled) return;
        setForm(selectedForm);

        const { data: questionRows, error: questionErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .eq('form_id', selectedForm.id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (questionErr) throw questionErr;
        const qList = (questionRows as EventRegistrationQuestion[]) ?? [];
        if (cancelled) return;
        setQuestions(qList);

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
          if (!cancelled) setOptions((optionRows as EventRegistrationQuestionOption[]) ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load registration form');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [standardMode, eventId, audience, formSlug]);

  useEffect(() => {
    if (!form?.id) {
      setSolutionCategories([]);
      return;
    }
    setSolutionCategories([]);
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('event_solution_categories')
        .select('category_name')
        .eq('form_id', form.id)
        .eq('is_hidden', false)
        .order('display_order', { ascending: true })
        .order('category_name', { ascending: true });
      if (cancelled) return;
      if (error) {
        setSolutionCategories([]);
        return;
      }
      setSolutionCategories(
        (data ?? [])
          .map((row) => String((row as { category_name?: string }).category_name ?? '').trim())
          .filter(Boolean),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [form?.id]);

  const optionsByQuestion = useMemo(() => {
    const map = new Map<string, EventRegistrationQuestionOption[]>();
    options.forEach((opt) => {
      const list = map.get(opt.question_id) ?? [];
      list.push(opt);
      map.set(opt.question_id, list);
    });
    return map;
  }, [options]);

  const sectionGroups = useMemo(() => {
    const dbAudience = resolveAudience(audience);
    const seenPrompts = new Set<string>();
    const base =
      registrationFlowMode === 'one_step'
        ? [
            ...filterRegistrationDetailsQuestions(dbAudience, questions),
            ...questions.filter(
              (q) =>
                !q.is_hidden &&
                q.prompt.trim().toLowerCase() === TERMS_ACCEPTANCE_PROMPT.trim().toLowerCase(),
            ),
          ]
        : questions.filter((q) => {
            if (q.is_hidden) return false;
            if (!isStage1RegistrationQuestion(dbAudience, q.prompt)) return false;
            return true;
          });
    const filtered = base.filter((q) => {
      if (q.is_hidden) return false;
      const promptNorm = q.prompt.trim().toLowerCase();
      if (REGISTRATION_HEADER_FIELD_PROMPTS.has(promptNorm)) return false;
      if (dbAudience === 'vendor' && VENDOR_DEPRECATED_OPERATIONS_PROMPTS.has(promptNorm)) return false;
      if (dbAudience === 'vendor' && promptNorm === 'company logo url') return false;
      if (!isRegistrationQuestionVisible(q, answers)) return false;
      if (seenPrompts.has(promptNorm)) return false;
      seenPrompts.add(promptNorm);
      return true;
    });
    // Follow Matchmaking form section_order exactly (Logistics last by default).
    const sectionOrder =
      form != null
        ? mergeSectionOrder(
            { audience: form.audience, section_order: form.section_order },
            questions,
          )
        : undefined;
    return groupQuestionsBySection(dbAudience, filtered, {
      sectionOrder: sectionOrder && sectionOrder.length > 0 ? sectionOrder : undefined,
    });
  }, [answers, audience, form, questions, registrationFlowMode]);

  const questionsForDisplay = useMemo(
    () => sectionGroups.flatMap((group) => group.questions),
    [sectionGroups],
  );

  const cellPhoneQuestion = useMemo(() => {
    const dbAudience = resolveAudience(audience);
    if (dbAudience !== 'attendee' && dbAudience !== 'vendor') return undefined;
    return questions.find((q) => q.prompt.trim().toLowerCase() === 'cell phone');
  }, [audience, questions]);

  /** Registration header fields in Matchmaking sort_order (admin ↑↓). */
  const registrationHeaderQuestions = useMemo(
    () =>
      questions
        .filter(
          (q) =>
            !q.is_hidden && REGISTRATION_HEADER_FIELD_PROMPTS.has(normalizeRegistrationPrompt(q.prompt)),
        )
        .sort((a, b) => a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt)),
    [questions],
  );

  const setAnswer = (questionId: string, value: string | string[] | boolean) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      for (const question of questions) {
        if (question.condition_question_id && !isRegistrationQuestionVisible(question, next)) {
          delete next[question.id];
        }
      }
      return next;
    });
  };

  const onUploadQuestionImage = async (questionId: string, file: File | null) => {
    if (!file || !eventId) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a JPEG or PNG image.');
      return;
    }
    const question = questions.find((q) => q.id === questionId);
    const isProfilePhoto = question ? isProfilePhotoRegistrationPrompt(question.prompt) : false;
    const folder = isProfilePhoto ? 'registration-headshots' : 'vendor-logos';
    setUploadingQuestionId(questionId);
    setError('');
    try {
      const url = await uploadEventImage(file, eventId, folder);
      delete pendingImageFilesRef.current[questionId];
      setAnswer(questionId, url);
      if (isProfilePhoto) {
        const { data: authData } = await supabase.auth.getUser();
        const formEmail = email.trim().toLowerCase();
        const sessionEmail = authData.user?.email?.trim().toLowerCase() ?? '';
        if (authData.user?.id && formEmail && sessionEmail === formEmail) {
          await syncUserAvatarFromUrl(authData.user.id, url);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const needsAuth =
        /sign in required/i.test(message) ||
        message.toLowerCase().includes('jwt') ||
        message.toLowerCase().includes('not authenticated');
      if (needsAuth) {
        // Public registration often picks images before the account exists — keep for submit.
        pendingImageFilesRef.current[questionId] = { file, folder };
        const previewUrl = URL.createObjectURL(file);
        setAnswer(questionId, previewUrl);
      } else if (isProfilePhoto) {
        setError(message || 'Could not upload your headshot. Please try again.');
      } else {
        setError(message || 'Could not upload your company logo. Please try again.');
      }
    } finally {
      setUploadingQuestionId('');
    }
  };

  const onUploadAttachment = async (questionId: string, file: File | null) => {
    if (!file || !eventId) return;
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'application/pdf',
    ]);
    const type = (file.type || '').toLowerCase();
    if (!allowed.has(type)) {
      setError('Attachments must be JPEG, PNG, or PDF.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError('Attachments must be 6MB or smaller.');
      return;
    }
    setUploadingQuestionId(questionId);
    setError('');
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext =
        type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
      const storagePath = `${eventId}/vendor-attachments/${Date.now()}_${safeName.replace(/\.[^.]+$/, '')}.${ext}`;
      const { data, error: uploadErr } = await supabase.storage.from('event-photos').upload(storagePath, file, {
        contentType: type,
        upsert: false,
      });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(data.path);
      setAnswer(questionId, pub.publicUrl || data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload attachment');
    } finally {
      setUploadingQuestionId('');
    }
  };

  const submit = async (status: 'draft' | 'submitted') => {
    if (!eventId || !form || !validAudience(audience)) return;
    const dbAudience = resolveAudience(audience);
    if (!registrationOpen) {
      setError('Registration is currently closed for this event.');
      return;
    }
    if (uploadingQuestionId) {
      setError('Please wait for the current upload to finish, then submit again.');
      return;
    }
    const missingBaseFields: string[] = [];
    if (!firstName.trim()) missingBaseFields.push('First name');
    if (!lastName.trim()) missingBaseFields.push('Last name');
    if (!email.trim()) missingBaseFields.push('Email');
    if (!companyName.trim()) missingBaseFields.push('Company');
    if ((dbAudience === 'attendee' || dbAudience === 'user') && !jobTitle.trim()) missingBaseFields.push('Job title');
    if (dbAudience === 'attendee' && cellPhoneQuestion?.is_required) {
      const cellValue = answers[cellPhoneQuestion.id];
      if (String(cellValue ?? '').trim() === '') missingBaseFields.push('Cell Phone');
    }
    const emailValue = email.trim();
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (missingBaseFields.length > 0) {
      setError(`Please complete required fields: ${missingBaseFields.join(', ')}.`);
      return;
    }
    const missingQuestions = questionsForDisplay
      .filter((q) => q.is_required)
      .filter((q) => {
        const promptNorm = q.prompt.trim().toLowerCase();
        // "Specify" only applies when minority-owned answer is Yes.
        if (promptNorm === MINORITY_SPECIFY_PROMPT.toLowerCase()) {
          const minorityQuestion = questionsForDisplay.find((x) => x.prompt.trim().toLowerCase() === MINORITY_OWNED_PROMPT.toLowerCase());
          const minorityAnswer = minorityQuestion ? answers[minorityQuestion.id] : undefined;
          if (minorityAnswer !== 'Yes') return false;
        }
        // Hidden in UI except when "No", so only require when applicable.
        if (promptNorm === LOGISTICS_VIRTUAL_PROMPT.toLowerCase()) {
          const attendingQuestion = questionsForDisplay.find((x) => {
            const norm = x.prompt.trim().toLowerCase();
            return norm === LOGISTICS_ATTENDING_PROMPT.toLowerCase() || norm === LEGACY_ATTENDING_PROMPT.toLowerCase();
          });
          const attendingAnswer = attendingQuestion ? answers[attendingQuestion.id] : undefined;
          if (attendingAnswer !== 'No') return false;
        }
        const value = answers[q.id];
        if (typeof value === 'boolean') return false;
        if (Array.isArray(value)) return value.length === 0;
        return String(value ?? '').trim() === '';
      });
    if (missingQuestions.length > 0) {
      const labels = missingQuestions.map((q) => {
        const promptNorm = q.prompt.trim().toLowerCase();
        if (promptNorm === 'company logo url' || promptNorm === 'company logo image') {
          return 'Company Logo Image';
        }
        return q.prompt;
      }).slice(0, 6);
      const extra = missingQuestions.length > 6 ? ` (+${missingQuestions.length - 6} more)` : '';
      setError(`Please answer required questions before submitting: ${labels.join(', ')}${extra}.`);
      return;
    }
    const descQuestion = questions.find((q) => q.prompt.trim().toLowerCase() === COMPANY_DESCRIPTION_PROMPT.toLowerCase());
    if (descQuestion) {
      const raw = answers[descQuestion.id];
      const desc = typeof raw === 'string' ? raw.trim() : '';
      if (desc.length > COMPANY_DESCRIPTION_MAX) {
        setError(`Company Description must be ${COMPANY_DESCRIPTION_MAX} characters or fewer.`);
        return;
      }
    }
    if (status === 'submitted') {
      if (password.length < 8) {
        setError('Choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let loginMessage = '';
      let authUserId: string | null = null;

      if (status === 'submitted' && emailValue) {
        let existingQuery = supabase
          .from('event_registration_submissions')
          .select('id')
          .eq('event_id', eventId)
          .eq('status', 'submitted')
          .ilike('email', emailValue);
        if (standardMode) existingQuery = existingQuery.eq('form_id', form.id);
        const { data: existingSubmission } = await existingQuery.limit(1).maybeSingle();
        if (existingSubmission && standardMode) {
          setError('You already registered for this event. Open the KBM Connect app and sign in with this email.');
          return;
        }
        if (existingSubmission) {
          setError(
            `You already registered for this event. Please use Login${dbAudience === 'vendor' ? ' (vendor portal)' : dbAudience === 'attendee' ? ' (delegate portal)' : ''} to access your registration.`,
          );
          return;
        }

        const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
        const accountResult = await ensureRegistrationAccount(emailValue, password, {
          full_name: fullName,
          event_id: eventId,
          attendee_type: dbAudience,
        });
        if ('error' in accountResult) {
          setError(accountResult.error);
          return;
        }
        authUserId = accountResult.userId;
      } else {
        const { data: authData } = await supabase.auth.getUser();
        authUserId = authData.user?.id ?? null;
      }

      // Upload any images that were picked before the account existed (headshot + company logo).
      const nextAnswers: AnswerMap = { ...answers };
      for (const [questionId, pending] of Object.entries(pendingImageFilesRef.current)) {
        try {
          const url = await uploadEventImage(pending.file, eventId, pending.folder);
          nextAnswers[questionId] = url;
          if (answers[questionId]?.toString().startsWith('blob:')) {
            try {
              URL.revokeObjectURL(String(answers[questionId]));
            } catch {
              /* ignore */
            }
          }
          delete pendingImageFilesRef.current[questionId];
        } catch (uploadErr) {
          const kind = pending.folder === 'vendor-logos' ? 'company logo' : 'headshot';
          throw new Error(
            uploadErr instanceof Error
              ? uploadErr.message
              : `Could not upload your ${kind}. Please try again.`,
          );
        }
      }
      if (nextAnswers !== answers) setAnswers(nextAnswers);

      const submissionPayload = {
        event_id: eventId,
        form_id: form.id,
        attendee_type: dbAudience,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        company_name: companyName.trim() || null,
        job_title: jobTitle.trim() || null,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
      };
      const identity = identityFromAnswers(
        questionsForDisplay,
        nextAnswers,
        identityFromSubmission({
          first_name: firstName,
          last_name: lastName,
          email,
          company_name: companyName,
          job_title: jobTitle,
        }),
      );
      const profileComplete =
        registrationFlowMode === 'one_step' &&
        status === 'submitted' &&
        contactFieldsComplete(identity) &&
        requiredQuestionsComplete(questionsForDisplay, nextAnswers);

      const submissionId = crypto.randomUUID();
      const { error: subErr } = await supabase
        .from('event_registration_submissions')
        .insert({
          id: submissionId,
          ...submissionPayload,
          user_id: authUserId,
          profile_complete: !standardMode && profileComplete,
          registration_status: status === 'submitted' ? 'pending_review' : 'pending_review',
          matching_opt_in: !standardMode && Boolean(profileComplete && status === 'submitted'),
        })
      if (subErr) throw subErr;

      const answerRows = questions
        .map((q) => {
          const value = nextAnswers[q.id];
          const promptNorm = q.prompt.trim().toLowerCase();
          if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
          if (typeof value === 'string' && value.startsWith('blob:')) return null;
          if (promptNorm === LOGISTICS_ATTENDING_PROMPT.toLowerCase()) {
            const virtualQuestion = questions.find((x) => x.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase());
            const payload = {
              onsite: String(value),
              representatives:
                String(value) === 'Yes'
                  ? representatives.filter(
                    (r) =>
                      r.firstName.trim() ||
                      r.lastName.trim() ||
                      r.title.trim() ||
                      r.workPhone.trim() ||
                      r.cell.trim() ||
                      r.email.trim()
                  )
                  : [],
              virtual: virtualQuestion ? nextAnswers[virtualQuestion.id] ?? null : vendorVirtualFallback || null,
            };
            return { submission_id: submissionId, question_id: q.id, answer_json: payload };
          }
          if (promptNorm === LEGACY_ATTENDING_PROMPT.toLowerCase()) {
            const virtualQuestion = questions.find((x) => x.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase());
            const payload = {
              onsite: String(value),
              representatives:
                String(value) === 'Yes'
                  ? representatives.filter(
                    (r) =>
                      r.firstName.trim() ||
                      r.lastName.trim() ||
                      r.title.trim() ||
                      r.workPhone.trim() ||
                      r.cell.trim() ||
                      r.email.trim()
                  )
                  : [],
              virtual: virtualQuestion ? nextAnswers[virtualQuestion.id] ?? null : vendorVirtualFallback || null,
            };
            return { submission_id: submissionId, question_id: q.id, answer_json: payload };
          }
          if (typeof value === 'boolean') return { submission_id: submissionId, question_id: q.id, answer_boolean: value };
          if (Array.isArray(value)) return { submission_id: submissionId, question_id: q.id, answer_json: value };
          if (q.question_type === 'number') return { submission_id: submissionId, question_id: q.id, answer_number: Number(value) };
          return { submission_id: submissionId, question_id: q.id, answer_text: value };
        })
        .filter(Boolean);
      if (answerRows.length > 0) {
        const { error: ansErr } = await supabase.from('event_registration_answers').insert(answerRows);
        if (ansErr) throw ansErr;
      }

      // The submission trigger may create a vendor booth before answer rows exist.
      // Run the same sync after answers are saved so first-time registrations
      // immediately include the company description, logo, and website.
      if (dbAudience === 'vendor' && authUserId) {
        try {
          const { error: boothSyncErr } = await supabase.rpc('ensure_matchmaking_vendor_booth', {
            p_submission_id: submissionId,
          });
          if (boothSyncErr && import.meta.env.DEV) {
            console.warn('Initial Solution Provider booth sync skipped:', boothSyncErr.message);
          }
        } catch (boothSyncError) {
          if (import.meta.env.DEV) {
            console.warn('Initial Solution Provider booth sync failed:', boothSyncError);
          }
        }
      }

      try {
        await syncSubmissionSolutionCategories(submissionId);
      } catch {
        /* Category sync is best-effort; registration still succeeds. */
      }

      const headshotUrl = findRegistrationHeadshotUrl(questionsForDisplay, nextAnswers);
      if (authUserId && headshotUrl) {
        try {
          await syncUserAvatarFromUrl(authUserId, headshotUrl);
        } catch {
          /* Profile photo sync is best-effort; registration still succeeds. */
        }
      }

      const requestRows = meetingTargets
        .filter((m) => m.company.trim() || m.person.trim() || m.reason.trim());
      if (dbAudience !== 'vendor') {
        const payload = requestRows.map((m, idx) => ({
          event_id: eventId,
          submission_id: submissionId,
          target_company_name: m.company.trim() || null,
          target_person_name: m.person.trim() || null,
          reason: m.reason.trim() || null,
          priority: idx,
        }));
        if (payload.length > 0) {
          const { error: reqErr } = await supabase.from('event_meeting_interest_requests').insert(payload);
          if (reqErr) throw reqErr;
        }
      }

      if (status === 'submitted' && emailValue && eventId) {
        const portalRole = dbAudience === 'vendor' ? 'vendor' : 'delegate';
        const loginUrl = publicPortalLoginUrl(eventId, portalRole);
        loginMessage =
          dbAudience === 'attendee' || dbAudience === 'vendor'
            ? ` We sent a confirmation email to ${emailValue} with a link to your portal. Sign in anytime at ${loginUrl} (use the email and password you just chose).`
            : '';
      }

      const portalRole = dbAudience === 'vendor' ? 'vendor' : 'delegate';
      const portalNote =
        (dbAudience === 'attendee' || dbAudience === 'vendor') && status === 'submitted' && eventId
          ? ` ${registrationFlowMode === 'one_step' ? `Sign in anytime at ${publicPortalLoginUrl(eventId, portalRole)}.` : `When your organizer opens the next registration stage, sign in at ${publicPortalLoginUrl(eventId, portalRole)}.`}`
          : '';
      if (standardMode && status === 'submitted') {
        setSuccess(
          `You're registered! We sent a confirmation to ${emailValue}. Download the KBM Connect app and sign in with this email and the password you just created.`,
        );
      } else {
        setSuccess(status === 'submitted' ? `Thank you. Your registration is submitted.${loginMessage}${portalNote}` : 'Draft saved.');
      }
      if (status === 'submitted') {
        setAnswers({});
        setMeetingTargets([{ company: '', person: '', reason: '' }]);
        setRepresentatives([{ firstName: '', lastName: '', title: '', workPhone: '', cell: '', email: '' }]);
        setVendorVirtualFallback('');
        setFirstName('');
        setLastName('');
        setEmail('');
        setCompanyName('');
        setJobTitle('');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (e) {
      const message =
        typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message?: unknown }).message === 'string'
          ? String((e as { message: string }).message)
          : 'Could not save registration';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={portalStyles.page}>Loading registration…</div>;
  if (!form || !validAudience(audience)) {
    return (
      <div className={portalStyles.page}>
        <p className={portalStyles.error}>{error || 'Form unavailable.'}</p>
        {standardMode ? (
          <p className={portalStyles.hint}>
            <Link to={`/e/${encodeURIComponent(siteSlug)}`}>Back to the event website</Link>
          </p>
        ) : eventId && validAudience(audience) ? (
          <p className={portalStyles.hint}>
            If registration was just opened, refresh this page. Otherwise ask the event admin to turn on
            Registration open in Matchmaking setup and keep the {audience} form active.
          </p>
        ) : null}
      </div>
    );
  }

  const dateRange = formatEventDateRange(eventInfo?.start_date, eventInfo?.end_date);
  const locationLine = [eventInfo?.venue, eventInfo?.location].filter(Boolean).join(' — ');
  const heroMessage = eventInfo?.welcome_message || eventInfo?.description || '';
  const dbAudience = resolveAudience(audience);
  const formTitle = displayRegistrationFormTitle(form, audience);
  const audienceTitle = formTitle;
  const pageHeading = form
    ? formTitle
    : `${eventInfo?.name ?? 'Event'} ${dbAudience === 'vendor' ? 'Vendor' : dbAudience === 'attendee' ? 'Delegate' : 'Speaker'} Registration`
        .replace(/\s+/g, ' ')
        .trim();
  const isJobTitleRequired = dbAudience === 'attendee' || dbAudience === 'user';
  const loginHref =
    dbAudience === 'vendor' && eventId
      ? publicPortalLoginUrl(eventId, 'vendor')
      : dbAudience === 'attendee' && eventId
        ? publicPortalLoginUrl(eventId, 'delegate')
        : '/login';
  const guestRole = dbAudience === 'vendor' ? 'vendor' : 'delegate';
  const minorityQuestion = questionsForDisplay.find((q) => q.prompt.trim().toLowerCase() === MINORITY_OWNED_PROMPT.toLowerCase());
  const minorityValue = minorityQuestion ? answers[minorityQuestion.id] : undefined;
  const virtualQuestion = questionsForDisplay.find((q) => q.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase());

  return (
    <PortalPublicShell
      event={eventInfo}
      nav={standardMode ? (
        <nav className={portalStyles.navBar}>
          {siteSlug ? (
            <Link to={`/e/${encodeURIComponent(siteSlug)}`} className={portalStyles.navLink}>
              ← Event website
            </Link>
          ) : null}
          <span className={portalStyles.navLinkActive}>Register</span>
        </nav>
      ) : eventId && (dbAudience === 'attendee' || dbAudience === 'vendor') ? (
        <PortalGuestNav
          eventId={eventId}
          role={guestRole}
          activeTab="welcome"
          formSlug={form?.slug ?? formSlug ?? null}
        />
      ) : (
        <nav className={portalStyles.navBar}>
          <span className={portalStyles.navLinkActive}>Welcome</span>
          <span className={portalStyles.navLinkDisabled}>Registration Details</span>
          <div className={portalStyles.userBar}>
            <a href={loginHref} className={portalStyles.logoutBtn}>
              Login
            </a>
          </div>
        </nav>
      )}
    >
        <div className={portalStyles.card}>
          {eventInfo ? (
            <PortalEventSummary
              eventName={eventInfo.name}
              dateRange={dateRange || null}
              locationLine={locationLine || null}
            />
          ) : null}
          <h2 className={portalStyles.welcomeHeading}>{formTitle}</h2>
          {eventInfo?.name ? (
            <p className={portalStyles.hint} style={{ marginTop: 4 }}>
              {eventInfo.name}
            </p>
          ) : null}
          {heroMessage ? <div className={portalStyles.contentBlock}>{heroMessage}</div> : null}
          {!heroMessage ? (
            <p className={portalStyles.hint}>Complete your registration details and submit your registration.</p>
          ) : null}
          {!standardMode ? (
            <p className={portalStyles.hint} style={{ marginTop: 20 }}>
              Track: {audienceTitle}
            </p>
          ) : null}
        </div>

        <div className={`${portalStyles.card} ${styles.formCard}`}>
        <h2>{pageHeading}</h2>
        <p className={styles.hint}>Complete the registration below, then submit to finish your registration.</p>
        <p className={styles.requiredHint}>* Required fields</p>
        <div ref={statusRef}>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className={styles.success} role="status">
              {success}
            </p>
          ) : null}
        </div>

        <p className={styles.section}>Registration</p>
        <div className={styles.grid2}>
          {(registrationHeaderQuestions.length > 0
            ? registrationHeaderQuestions
            : [
                { id: '__first_name', prompt: 'First Name', is_required: true },
                { id: '__last_name', prompt: 'Last Name', is_required: true },
                { id: '__email', prompt: 'E-Mail Address', is_required: true },
                { id: '__company', prompt: 'Company Name', is_required: true },
                { id: '__job', prompt: 'Job Title', is_required: isJobTitleRequired },
              ]
          ).map((q) => {
            const promptNorm = normalizeRegistrationPrompt(q.prompt);
            if (promptNorm === 'first name') {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    First name <span className={styles.requiredStar}>*</span>
                  </span>
                  <input autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
              );
            }
            if (promptNorm === 'last name') {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    Last name <span className={styles.requiredStar}>*</span>
                  </span>
                  <input autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </label>
              );
            }
            if (promptNorm === 'e-mail address' || promptNorm === 'email') {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    Email <span className={styles.requiredStar}>*</span>
                  </span>
                  <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              );
            }
            if (promptNorm === 'company name') {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    Company <span className={styles.requiredStar}>*</span>
                  </span>
                  <input
                    autoComplete="organization"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </label>
              );
            }
            if (promptNorm === 'job title') {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    Job title {isJobTitleRequired || q.is_required ? <span className={styles.requiredStar}>*</span> : null}
                  </span>
                  <input
                    autoComplete="organization-title"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </label>
              );
            }
            if (promptNorm === 'cell phone' && cellPhoneQuestion) {
              return (
                <label key={q.id}>
                  <span className={styles.questionLabel}>
                    Cell Phone {cellPhoneQuestion.is_required ? <span className={styles.requiredStar}>*</span> : null}
                  </span>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={
                      typeof answers[cellPhoneQuestion.id] === 'string'
                        ? (answers[cellPhoneQuestion.id] as string)
                        : ''
                    }
                    onChange={(e) => setAnswer(cellPhoneQuestion.id, e.target.value)}
                  />
                </label>
              );
            }
            return null;
          })}
        </div>

        <div className={styles.grid2}>
          <label>
            <span className={styles.questionLabel}>
              Password <span className={styles.requiredStar}>*</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            <span className={styles.questionLabel}>
              Confirm password <span className={styles.requiredStar}>*</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
            />
          </label>
        </div>
        {standardMode ? (
          <p className={styles.hint}>
            Choose a password now — you will use it with this email to sign in to the KBM Connect app.
          </p>
        ) : dbAudience === 'attendee' || dbAudience === 'vendor' ? (
          <p className={styles.hint}>
            Choose a password now — you will use it to sign in to your {dbAudience === 'vendor' ? 'vendor' : 'delegate'}{' '}
            portal after registration (Login link at the top of this page).
          </p>
        ) : null}

        <div className={portalStyles.registrationSections}>
          {sectionGroups.map(({ sectionLabel, questions: sectionQuestions }) => {
            const showSectionHeading =
              sectionLabel !== 'General' &&
              sectionLabel.toLowerCase() !== 'registration' &&
              sectionLabel.toLowerCase() !== 'registration details';
            return (
              <section key={sectionLabel} className={portalStyles.registrationSection}>
                {showSectionHeading ? (
                  <h2 className={portalStyles.registrationSectionHeading}>{sectionLabel}</h2>
                ) : null}
                <div className={styles.questionsGrid}>
                  {sectionQuestions.map((q) => {
            if (q.prompt.trim().toLowerCase() === MINORITY_SPECIFY_PROMPT.toLowerCase() && minorityValue !== 'Yes') return null;
            // The virtual follow-up is rendered under the logistics block to avoid duplicates.
            if (q.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase()) return null;
            const value = answers[q.id];
            const list = optionsByQuestion.get(q.id) ?? [];
            const promptNorm = q.prompt.trim().toLowerCase();
            const isAttendingField = promptNorm === LOGISTICS_ATTENDING_PROMPT.toLowerCase() || promptNorm === LEGACY_ATTENDING_PROMPT.toLowerCase();
            const isCompanyLogoField = promptNorm === 'company logo url' || promptNorm === 'company logo image';
            const isSpeakerHeadshotField = promptNorm === 'speaker headshot';
            const isHeadshotField = isProfilePhotoRegistrationPrompt(q.prompt);
            const isAdditionalInfoField = promptNorm === ADDITIONAL_INFO_PROMPT.toLowerCase() || promptNorm === 'additional information attachment';
            const isTermsPrompt = promptNorm.includes('i have read and accept the terms and conditions');
            const isCompanyDescription = q.prompt.trim().toLowerCase() === COMPANY_DESCRIPTION_PROMPT.toLowerCase();
            const isWideQuestion = q.question_type === 'multi_select' || isAttendingField || isHeadshotField;
            const sl = (q.section_label || '').trim().toLowerCase();
            const isSolutionProviderCategory =
              q.question_type === 'multi_select' &&
              (sl === 'solution provider categories' || sl === 'solution providers categories');
            const textValue = typeof value === 'string' ? value : '';
            const charCount = isCompanyDescription ? textValue.length : 0;
            const labelText = isAttendingField
              ? LOGISTICS_ATTENDING_PROMPT
              : isCompanyLogoField
                ? 'Company Logo Image'
                : isSpeakerHeadshotField
                  ? 'Speaker Headshot'
                : isHeadshotField
                  ? 'Headshot / Photo'
                : isAdditionalInfoField
                  ? 'Additional Information Attachment'
                  : isTermsPrompt
                    ? TERMS_ACCEPTANCE_PROMPT
                    : q.prompt;
            return (
              <div key={q.id} className={`${styles.question} ${isWideQuestion ? styles.questionWide : ''}`}>
              <label>
                <span className={isSolutionProviderCategory ? styles.questionLabelStrong : styles.questionLabel}>
                  {labelText} {q.is_required ? <span className={styles.requiredStar}>*</span> : ''}
                </span>
                {isCompanyDescription ? (
                  <span className={styles.counterSpacer} />
                ) : null}
                {q.question_type === 'textarea' ? (
                  <>
                    <textarea
                      value={textValue}
                      maxLength={isCompanyDescription ? COMPANY_DESCRIPTION_MAX : undefined}
                      required={q.is_required}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    />
                    {isCompanyDescription ? (
                      <div className={styles.counterRow}>
                        <span>{charCount}/{COMPANY_DESCRIPTION_MAX}</span>
                      </div>
                    ) : null}
                  </>
                ) : isTermsPrompt ? (
                  <label className={styles.termsRow}>
                    <input
                      type="checkbox"
                      checked={String(value || '').toLowerCase() === 'yes'}
                      onChange={(e) => setAnswer(q.id, e.target.checked ? 'Yes' : 'No')}
                    />
                    <span>{TERMS_ACCEPTANCE_PROMPT}</span>
                  </label>
                ) : q.question_type === 'single_select' ? (
                  <select required={q.is_required} value={typeof value === 'string' ? value : ''} onChange={(e) => setAnswer(q.id, e.target.value)}>
                    <option value="">Select</option>
                    {list.map((opt) => <option key={opt.id} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : q.question_type === 'multi_select' ? (
                  <div className={styles.checks}>
                    {(isSolutionCategoryInterestPrompt(q.prompt)
                      ? solutionCategories.map((name) => ({ id: name, label: name, value: name }))
                      : list.map((opt) => ({ id: opt.id, label: opt.label, value: opt.value }))
                    ).map((opt) => {
                      const selected = Array.isArray(value) ? value.includes(opt.value) : false;
                      return (
                        <label key={opt.id} className={styles.checkItem}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              const prev = Array.isArray(value) ? value : [];
                              setAnswer(
                                q.id,
                                e.target.checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value)
                              );
                            }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                    {isSolutionCategoryInterestPrompt(q.prompt) && solutionCategories.length === 0 ? (
                      <p className={styles.hint}>
                        Solution categories will appear here once your event admin adds them.
                      </p>
                    ) : null}
                  </div>
                ) : q.question_type === 'boolean' ? (
                  <select
                    required={q.is_required}
                    value={typeof value === 'boolean' ? String(value) : ''}
                    onChange={(e) => setAnswer(q.id, e.target.value === 'true')}
                  >
                    <option value="">Select</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : isCompanyLogoField || isHeadshotField ? (
                  <div className={styles.uploadRow}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      disabled={uploadingQuestionId === q.id}
                      onChange={(e) => void onUploadQuestionImage(q.id, e.target.files?.[0] ?? null)}
                    />
                    {textValue && isUsableProfilePhotoUrl(textValue) ? (
                      <a href={textValue} target="_blank" rel="noreferrer">
                        {isHeadshotField ? 'View uploaded photo' : 'View uploaded logo'}
                      </a>
                    ) : textValue && textValue.startsWith('blob:') ? (
                      <span className={styles.fieldHint}>
                        {isHeadshotField
                          ? 'Photo selected — it uploads when you submit.'
                          : 'Logo selected — it uploads when you submit.'}
                      </span>
                    ) : isHeadshotField ? (
                      <span className={styles.fieldHint}>No photo uploaded yet. Choose a file to add or replace.</span>
                    ) : textValue ? (
                      <a href={textValue} target="_blank" rel="noreferrer">
                        View uploaded logo
                      </a>
                    ) : (
                      <span className={styles.fieldHint}>No logo uploaded yet. Choose a file to add.</span>
                    )}
                    <small className={styles.fieldHint}>
                      {isHeadshotField
                        ? 'Choose a clear photo of yourself (JPG/PNG). You can replace it anytime by picking a new file. This becomes your profile picture in the app.'
                        : 'Accepted formats: JPG, JPEG, PNG, GIF. The logo uploads when you create your account and submit.'}
                    </small>
                    {uploadingQuestionId === q.id ? <small>Uploading image…</small> : null}
                  </div>
                ) : isAdditionalInfoField ? (
                  <div className={styles.uploadRow}>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png"
                      disabled={uploadingQuestionId === q.id}
                      onChange={(e) => void onUploadAttachment(q.id, e.target.files?.[0] ?? null)}
                    />
                    {textValue ? <a href={textValue} target="_blank" rel="noreferrer">View uploaded attachment</a> : null}
                    <small className={styles.fieldHint}>Attach PDF, DOC/DOCX, PPT, XLS, or image file.</small>
                    {uploadingQuestionId === q.id ? <small>Uploading attachment…</small> : null}
                  </div>
                ) : (
                  <input
                    type={q.question_type === 'number' ? 'number' : q.question_type === 'email' ? 'email' : 'text'}
                    required={q.is_required}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                )}
              </label>
              {isAttendingField && value === 'Yes' ? (
                <div className={styles.repBlock}>
                  <h4>Attending representatives</h4>
                  {representatives.map((rep, idx) => (
                    <div key={idx} className={styles.grid3}>
                      <label>
                        First
                        <input
                          value={rep.firstName}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, firstName: e.target.value } : r)))
                          }
                        />
                      </label>
                      <label>
                        Last
                        <input
                          value={rep.lastName}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, lastName: e.target.value } : r)))
                          }
                        />
                      </label>
                      <label>
                        Title
                        <input
                          value={rep.title}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, title: e.target.value } : r)))
                          }
                        />
                      </label>
                      <label>
                        Work Phone
                        <input
                          value={rep.workPhone}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, workPhone: e.target.value } : r)))
                          }
                        />
                      </label>
                      <label>
                        Cell
                        <input
                          value={rep.cell}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, cell: e.target.value } : r)))
                          }
                        />
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={rep.email}
                          onChange={(e) =>
                            setRepresentatives((prev) => prev.map((r, i) => (i === idx ? { ...r, email: e.target.value } : r)))
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() =>
                      setRepresentatives((prev) => [...prev, { firstName: '', lastName: '', title: '', workPhone: '', cell: '', email: '' }])
                    }
                  >
                    Add representative
                  </button>
                </div>
              ) : null}
              {isAttendingField && value === 'No' ? (
                <div className={styles.followUpField}>
                  <label>
                    <span className={styles.questionLabel}>{LOGISTICS_VIRTUAL_PROMPT}</span>
                    {virtualQuestion ? (
                      <select
                        value={typeof answers[virtualQuestion.id] === 'string' ? String(answers[virtualQuestion.id]) : ''}
                        onChange={(e) => setAnswer(virtualQuestion.id, e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      <select value={vendorVirtualFallback} onChange={(e) => setVendorVirtualFallback(e.target.value)}>
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    )}
                  </label>
                </div>
              ) : null}
              </div>
            );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {dbAudience !== 'vendor' && dbAudience !== 'attendee' ? (
          <>
            <h2>Who would you like to meet? (optional)</h2>
            {meetingTargets.map((m, idx) => (
              <div key={idx} className={styles.grid3}>
                <label>Company<input value={m.company} onChange={(e) => setMeetingTargets((prev) => prev.map((x, i) => (i === idx ? { ...x, company: e.target.value } : x)))} /></label>
                <label>Person<input value={m.person} onChange={(e) => setMeetingTargets((prev) => prev.map((x, i) => (i === idx ? { ...x, person: e.target.value } : x)))} /></label>
                <label>Reason<input value={m.reason} onChange={(e) => setMeetingTargets((prev) => prev.map((x, i) => (i === idx ? { ...x, reason: e.target.value } : x)))} /></label>
              </div>
            ))}
            <button type="button" className={styles.ghostBtn} onClick={() => setMeetingTargets((prev) => [...prev, { company: '', person: '', reason: '' }])}>
              Add another meeting request
            </button>
          </>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={saving || !registrationOpen || Boolean(uploadingQuestionId)}
            onClick={() => void submit('submitted')}
          >
            {saving ? 'Saving…' : 'Submit registration'}
          </button>
        </div>
        </div>
    </PortalPublicShell>
  );
}
