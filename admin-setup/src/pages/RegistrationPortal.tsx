import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { compressImageToJpegBlob, uploadEventImage } from '../lib/uploadEventImage';
import type {
  Event,
  EventRegistrationForm,
  EventRegistrationQuestion,
  EventRegistrationQuestionOption,
  MatchmakingAudience,
} from '../lib/types';
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
const COMPANY_DESCRIPTION_PROMPT = 'Company Description';
const COMPANY_DESCRIPTION_MIN = 80;
const COMPANY_DESCRIPTION_MAX = 600;
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
  'id' | 'name' | 'description' | 'location' | 'venue' | 'start_date' | 'end_date' | 'banner_url' | 'welcome_title' | 'welcome_subtitle' | 'welcome_message'
>;

const validAudience = (value: string | undefined): value is MatchmakingAudience | 'speaker' =>
  value === 'attendee' || value === 'vendor' || value === 'user' || value === 'speaker';

const resolveAudience = (value: string | undefined): MatchmakingAudience =>
  value === 'speaker' ? 'user' : value === 'attendee' || value === 'vendor' || value === 'user' ? value : 'attendee';

const formatDateRange = (startIso?: string, endIso?: string) => {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
};

const makeTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
};

const fileToDataUrl = async (file: File) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

export default function RegistrationPortal() {
  const { eventId, audience } = useParams<{ eventId: string; audience: string }>();
  const [eventInfo, setEventInfo] = useState<PublicEventInfo | null>(null);
  const [form, setForm] = useState<EventRegistrationForm | null>(null);
  const [questions, setQuestions] = useState<EventRegistrationQuestion[]>([]);
  const [options, setOptions] = useState<EventRegistrationQuestionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [uploadingQuestionId, setUploadingQuestionId] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [representatives, setRepresentatives] = useState<VendorRepresentative[]>([
    { firstName: '', lastName: '', title: '', workPhone: '', cell: '', email: '' },
  ]);
  const [vendorVirtualFallback, setVendorVirtualFallback] = useState('');
  const [meetingTargets, setMeetingTargets] = useState<Array<{ company: string; person: string; reason: string }>>([
    { company: '', person: '', reason: '' },
  ]);

  useEffect(() => {
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
          .select('id, name, description, location, venue, start_date, end_date, banner_url, welcome_title, welcome_subtitle, welcome_message')
          .eq('id', eventId)
          .maybeSingle();
        if (!cancelled) setEventInfo((eventRow as PublicEventInfo | null) ?? null);

        const { data: settingsRow, error: settingsErr } = await supabase
          .from('event_matchmaking_settings')
          .select('registration_open')
          .eq('event_id', eventId)
          .maybeSingle();
        if (settingsErr) throw settingsErr;
        const isOpen = Boolean((settingsRow as { registration_open?: boolean } | null)?.registration_open);
        if (!cancelled) setRegistrationOpen(isOpen);
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
          .order('sort_order', { ascending: true });
        if (formErr) throw formErr;
        const matchingForms = (formRows as EventRegistrationForm[]) ?? [];
        const canonicalName = dbAudience === 'attendee' ? KBM_ATTENDEE_FORM_NAME : dbAudience === 'vendor' ? KBM_VENDOR_FORM_NAME : 'Speaker Registration';
        const formRow =
          matchingForms.find((f) => canonicalName && f.name === canonicalName) ??
          matchingForms.find((f) => !/meet\s*max/i.test(f.name)) ??
          matchingForms[0] ??
          null;
        if (!formRow) {
          throw new Error(
            `Registration is not available for ${audience} yet. Ask the event admin to turn on "Registration open" and keep the ${audience} form active in Matchmaking setup.`
          );
        }
        const selectedForm = formRow as EventRegistrationForm;
        if (cancelled) return;
        setForm(selectedForm);

        const { data: questionRows, error: questionErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .eq('form_id', selectedForm.id)
          .eq('is_hidden', false)
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
  }, [eventId, audience]);

  const optionsByQuestion = useMemo(() => {
    const map = new Map<string, EventRegistrationQuestionOption[]>();
    options.forEach((opt) => {
      const list = map.get(opt.question_id) ?? [];
      list.push(opt);
      map.set(opt.question_id, list);
    });
    return map;
  }, [options]);

  const questionsForDisplay = useMemo(() => {
    // Basic profile fields are already collected in the top grid.
    const duplicatePrompts = new Set(['company name', 'first name', 'last name', 'e-mail address', 'email', 'job title']);
    const seenPrompts = new Set<string>();
    return questions.filter((q) => {
      const promptNorm = q.prompt.trim().toLowerCase();
      if (duplicatePrompts.has(promptNorm)) return false;
      const isVendor = resolveAudience(audience) === 'vendor';
      if (isVendor && VENDOR_DEPRECATED_OPERATIONS_PROMPTS.has(promptNorm)) return false;
      // Prefer "Company Logo Image" and suppress legacy "Company Logo URL".
      if (isVendor && promptNorm === 'company logo url') return false;
      // Keep first occurrence only; removes accidental duplicates in event data.
      if (seenPrompts.has(promptNorm)) return false;
      seenPrompts.add(promptNorm);
      return true;
    });
  }, [audience, questions]);

  const setAnswer = (questionId: string, value: string | string[] | boolean) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const onUploadQuestionImage = async (questionId: string, file: File | null) => {
    if (!file || !eventId) return;
    setUploadingQuestionId(questionId);
    setError('');
    try {
      const url = await uploadEventImage(file, eventId, 'vendor-logos');
      setAnswer(questionId, url);
    } catch (e) {
      try {
        // Public registrants might not be signed in; keep flow working by storing a data URL.
        const jpegBlob = await compressImageToJpegBlob(file, { maxWidth: 1200, quality: 0.82 });
        const dataUrl = await fileToDataUrl(new File([jpegBlob], `${Date.now()}-upload.jpg`, { type: 'image/jpeg' }));
        setAnswer(questionId, dataUrl);
      } catch {
        setError(e instanceof Error ? e.message : 'Could not upload image');
      }
    } finally {
      setUploadingQuestionId('');
    }
  };

  const onUploadAttachment = async (questionId: string, file: File | null) => {
    if (!file || !eventId) return;
    setUploadingQuestionId(questionId);
    setError('');
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${eventId}/vendor-attachments/${Date.now()}_${safeName}`;
      const { data, error: uploadErr } = await supabase.storage.from('event-photos').upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('event-photos').getPublicUrl(data.path);
      setAnswer(questionId, pub.publicUrl || data.path);
    } catch (e) {
      try {
        const dataUrl = await fileToDataUrl(file);
        setAnswer(questionId, dataUrl);
      } catch {
        setError(e instanceof Error ? e.message : 'Could not upload attachment');
      }
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
      const labels = missingQuestions.map((q) => q.prompt).slice(0, 6);
      const extra = missingQuestions.length > 6 ? ` (+${missingQuestions.length - 6} more)` : '';
      setError(`Please answer required questions before submitting: ${labels.join(', ')}${extra}.`);
      return;
    }
    const descQuestion = questions.find((q) => q.prompt.trim().toLowerCase() === COMPANY_DESCRIPTION_PROMPT.toLowerCase());
    if (descQuestion) {
      const raw = answers[descQuestion.id];
      const desc = typeof raw === 'string' ? raw.trim() : '';
      if (desc.length > 0 && (desc.length < COMPANY_DESCRIPTION_MIN || desc.length > COMPANY_DESCRIPTION_MAX)) {
        setError(`Company Description must be ${COMPANY_DESCRIPTION_MIN}-${COMPANY_DESCRIPTION_MAX} characters.`);
        return;
      }
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let loginMessage = '';
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
      const submissionId = crypto.randomUUID();
      const { error: subErr } = await supabase
        .from('event_registration_submissions')
        .insert({
          id: submissionId,
          ...submissionPayload,
          // Keep portal registrations on the public flow so RLS behaves consistently
          // whether or not a stale browser auth session exists.
          user_id: null,
        })
      if (subErr) throw subErr;

      const answerRows = questions
        .map((q) => {
          const value = answers[q.id];
          const promptNorm = q.prompt.trim().toLowerCase();
          if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
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
              virtual: virtualQuestion ? answers[virtualQuestion.id] ?? null : vendorVirtualFallback || null,
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
              virtual: virtualQuestion ? answers[virtualQuestion.id] ?? null : vendorVirtualFallback || null,
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

      if (status === 'submitted' && email.trim()) {
        const normalizedEmail = email.trim().toLowerCase();
        const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
        const usernameQuestion = questions.find((q) => q.prompt.toLowerCase().includes('username'));
        const usernameValue = usernameQuestion ? (answers[usernameQuestion.id] as string | undefined) : undefined;
        const tempPassword = makeTemporaryPassword();

        const { error: signUpErr } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: tempPassword,
          options: {
            data: {
              full_name: fullName || null,
              event_id: eventId,
              attendee_type: dbAudience,
            },
          },
        });

        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
        if (!resetErr) {
          loginMessage =
            ` Login setup: ${usernameValue ? `Username: ${String(usernameValue)}. ` : ''}Email: ${normalizedEmail}. ` +
            'We sent an email with instructions to set your password and log in.';
        } else if (!signUpErr) {
          loginMessage =
            ` Login credentials: ${usernameValue ? `Username: ${String(usernameValue)}. ` : ''}Email: ${normalizedEmail}. ` +
            `Temporary password: ${tempPassword}. Please log in and change your password immediately.`;
        } else {
          loginMessage =
            ` Registration saved, but automatic login setup was not completed (${signUpErr.message || 'auth setup failed'}). ` +
            'Please use Forgot Password on login to set your password.';
        }
      }

      setSuccess(status === 'submitted' ? `Thank you. Your registration is submitted.${loginMessage}` : 'Draft saved.');
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

  if (loading) return <div className={styles.page}>Loading registration…</div>;
  if (!form || !validAudience(audience)) return <div className={styles.page}>Form unavailable.</div>;

  const dateRange = formatDateRange(eventInfo?.start_date, eventInfo?.end_date);
  const heroMessage = eventInfo?.welcome_message || eventInfo?.description || '';
  const dbAudience = resolveAudience(audience);
  const audienceTitle = dbAudience === 'vendor' ? 'Vendor registration' : dbAudience === 'attendee' ? 'Attendee registration' : 'Speaker registration';
  const pageHeading = `${eventInfo?.name ?? 'Event'} ${dbAudience === 'vendor' ? 'Vendor' : dbAudience === 'attendee' ? 'Attendee' : 'Speaker'} Registration`.replace(/\s+/g, ' ').trim();
  const isJobTitleRequired = dbAudience === 'attendee' || dbAudience === 'user';
  const minorityQuestion = questionsForDisplay.find((q) => q.prompt.trim().toLowerCase() === MINORITY_OWNED_PROMPT.toLowerCase());
  const minorityValue = minorityQuestion ? answers[minorityQuestion.id] : undefined;
  const virtualQuestion = questionsForDisplay.find((q) => q.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase());

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        {eventInfo?.banner_url ? <img src={eventInfo.banner_url} alt={eventInfo.name || 'Event banner'} className={styles.heroImage} /> : null}
        {!eventInfo?.banner_url ? <div className={styles.heroPlaceholder}>Event banner</div> : null}
      </section>

      <nav className={styles.topNav}>
        <span>Welcome</span>
        <span>Registration Details</span>
        <span>1:1 Meeting Requests</span>
        <a href="/login" className={styles.loginBtn}>Login</a>
      </nav>

      <section className={styles.infoCard}>
        <h2>Welcome</h2>
        {heroMessage ? <p>{heroMessage}</p> : <p>Complete your registration details and submit your preferred 1:1 meeting requests.</p>}
      </section>

      <section className={styles.infoCard}>
        <h3>Event information</h3>
        <div className={styles.infoGrid}>
          <div>
            <strong>Registration type</strong>
            <p>{audienceTitle}</p>
          </div>
          {dateRange ? (
            <div>
              <strong>Event dates</strong>
              <p>{dateRange}</p>
            </div>
          ) : null}
          {eventInfo?.venue ? (
            <div>
              <strong>Venue</strong>
              <p>{eventInfo.venue}</p>
            </div>
          ) : null}
          {eventInfo?.location ? (
            <div>
              <strong>Location</strong>
              <p>{eventInfo.location}</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className={styles.card}>
        <h2>{pageHeading}</h2>
        <p className={styles.hint}>Complete the registration below, then submit to finish your registration.</p>
        <p className={styles.requiredHint}>* Required fields</p>
        {error ? <p className={styles.error}>{error}</p> : null}
        {success ? <p className={styles.success}>{success}</p> : null}

        <div className={styles.grid2}>
          <label>
            First name <span className={styles.requiredStar}>*</span>
            <input autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label>
            Last name <span className={styles.requiredStar}>*</span>
            <input autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label>
            Email <span className={styles.requiredStar}>*</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Company <span className={styles.requiredStar}>*</span>
            <input autoComplete="organization" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </label>
          <label>
            Job title {isJobTitleRequired ? <span className={styles.requiredStar}>*</span> : null}
            <input autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
        </div>

        <div className={styles.questionsGrid}>
          {questionsForDisplay.map((q, idx) => {
            if (q.prompt.trim().toLowerCase() === MINORITY_SPECIFY_PROMPT.toLowerCase() && minorityValue !== 'Yes') return null;
            // The virtual follow-up is rendered under the logistics block to avoid duplicates.
            if (q.prompt.trim().toLowerCase() === LOGISTICS_VIRTUAL_PROMPT.toLowerCase()) return null;
            const value = answers[q.id];
            const list = optionsByQuestion.get(q.id) ?? [];
            const promptNorm = q.prompt.trim().toLowerCase();
            const isAttendingField = promptNorm === LOGISTICS_ATTENDING_PROMPT.toLowerCase() || promptNorm === LEGACY_ATTENDING_PROMPT.toLowerCase();
            const isCompanyLogoField = promptNorm === 'company logo url' || promptNorm === 'company logo image';
            const isSpeakerHeadshotField = promptNorm === 'speaker headshot';
            const isAdditionalInfoField = promptNorm === ADDITIONAL_INFO_PROMPT.toLowerCase() || promptNorm === 'additional information attachment';
            const isTermsPrompt = promptNorm.includes('i have read and accept the terms and conditions');
            const isCompanyDescription = q.prompt.trim().toLowerCase() === COMPANY_DESCRIPTION_PROMPT.toLowerCase();
            const isWideQuestion = q.question_type === 'multi_select' || isAttendingField;
            const isSolutionProviderCategory = q.question_type === 'multi_select' && (q.section_label || '').trim().toLowerCase() === 'solution provider categories';
            const textValue = typeof value === 'string' ? value : '';
            const charCount = isCompanyDescription ? textValue.length : 0;
            const prevSectionLabel = idx > 0 ? (questionsForDisplay[idx - 1]?.section_label ?? '').trim() : '';
            const showSectionLabel = Boolean(q.section_label && q.section_label.trim() && q.section_label.trim() !== prevSectionLabel);
            const labelText = isAttendingField
              ? LOGISTICS_ATTENDING_PROMPT
              : isCompanyLogoField
                ? 'Company Logo Image'
                : isSpeakerHeadshotField
                  ? 'Speaker Headshot'
                : isAdditionalInfoField
                  ? 'Additional Information Attachment'
                  : q.prompt;
            return (
              <div key={q.id} className={`${styles.question} ${isWideQuestion ? styles.questionWide : ''}`}>
              {showSectionLabel ? <p className={styles.section}>{q.section_label}</p> : null}
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
                        <span>{charCount}/{COMPANY_DESCRIPTION_MAX} (min {COMPANY_DESCRIPTION_MIN})</span>
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
                    <span>I have read and accept the Terms and Conditions, Code of Conduct, and COVID waiver.</span>
                  </label>
                ) : q.question_type === 'single_select' ? (
                  <select required={q.is_required} value={typeof value === 'string' ? value : ''} onChange={(e) => setAnswer(q.id, e.target.value)}>
                    <option value="">Select</option>
                    {list.map((opt) => <option key={opt.id} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : q.question_type === 'multi_select' ? (
                  <div className={styles.checks}>
                    {list.map((opt) => {
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
                          {opt.label}
                        </label>
                      );
                    })}
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
                ) : isCompanyLogoField || isSpeakerHeadshotField ? (
                  <div className={styles.uploadRow}>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingQuestionId === q.id}
                      onChange={(e) => void onUploadQuestionImage(q.id, e.target.files?.[0] ?? null)}
                    />
                    {textValue ? <a href={textValue} target="_blank" rel="noreferrer">{isSpeakerHeadshotField ? 'View uploaded headshot' : 'View uploaded logo'}</a> : null}
                    <small className={styles.fieldHint}>Accepted formats: JPG, JPEG, PNG, GIF.</small>
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
                <div className={styles.repBlock}>
                  <h4>{LOGISTICS_VIRTUAL_PROMPT}</h4>
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
                </div>
              ) : null}
              </div>
            );
          })}
        </div>

        {dbAudience !== 'vendor' ? (
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
    </div>
  );
}
