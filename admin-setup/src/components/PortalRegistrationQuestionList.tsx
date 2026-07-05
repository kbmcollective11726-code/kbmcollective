import { useEffect, useMemo, useState } from 'react';
import { compressImageToJpegBlob, uploadEventImage } from '../lib/uploadEventImage';
import { TERMS_ACCEPTANCE_PROMPT } from '../lib/portalRegistrationDetailsQuestions';
import { groupQuestionsBySection } from '../lib/registrationSectionLabels';
import { isHeadshotPrompt, isSolutionCategoryInterestPrompt } from '../lib/specRegistrationQuestions';
import { supabase } from '../lib/supabase';
import type { EventRegistrationQuestion, EventRegistrationQuestionOption, MatchmakingAudience } from '../lib/types';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';

type AnswerMap = Record<string, string | string[] | boolean>;

const COMPANY_DESCRIPTION_PROMPT = 'Company Description';
const COMPANY_DESCRIPTION_MIN = 80;
const COMPANY_DESCRIPTION_MAX = 600;
const MINORITY_OWNED_PROMPT = 'Are you a minority owned organization?';
const MINORITY_SPECIFY_PROMPT = 'Specify your minority owned business';

interface Props {
  eventId: string;
  audience: MatchmakingAudience;
  questions: EventRegistrationQuestion[];
  options: EventRegistrationQuestionOption[];
  answers: AnswerMap;
  onChange: (questionId: string, value: string | string[] | boolean) => void;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function PortalRegistrationQuestionList({
  eventId,
  audience,
  questions,
  options,
  answers,
  onChange,
}: Props) {
  const [uploadingQuestionId, setUploadingQuestionId] = useState('');
  const [solutionCategories, setSolutionCategories] = useState<string[]>([]);

  const sectionGroups = useMemo(() => groupQuestionsBySection(audience, questions), [audience, questions]);

  const needsSolutionCategories = useMemo(
    () => questions.some((q) => isSolutionCategoryInterestPrompt(q.prompt)),
    [questions],
  );

  useEffect(() => {
    if (!needsSolutionCategories) {
      setSolutionCategories([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('event_solution_categories')
        .select('category_name')
        .eq('event_id', eventId)
        .order('display_order', { ascending: true })
        .order('category_name', { ascending: true });
      if (cancelled) return;
      if (!error) {
        setSolutionCategories((data ?? []).map((row) => String(row.category_name ?? '').trim()).filter(Boolean));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, needsSolutionCategories]);

  const optionsByQuestion = useMemo(() => {
    const map = new Map<string, EventRegistrationQuestionOption[]>();
    options.forEach((opt) => {
      const list = map.get(opt.question_id) ?? [];
      list.push(opt);
      map.set(opt.question_id, list);
    });
    return map;
  }, [options]);

  const minorityQuestion = questions.find((q) => q.prompt.trim().toLowerCase() === MINORITY_OWNED_PROMPT.toLowerCase());
  const minorityValue = minorityQuestion ? answers[minorityQuestion.id] : undefined;

  const onUploadImage = async (questionId: string, file: File | null) => {
    if (!file) return;
    setUploadingQuestionId(questionId);
    try {
      const url = await uploadEventImage(file, eventId, 'vendor-logos');
      onChange(questionId, url);
    } catch {
      try {
        const jpegBlob = await compressImageToJpegBlob(file, { maxWidth: 1200, quality: 0.82 });
        const dataUrl = await fileToDataUrl(new File([jpegBlob], `${Date.now()}-upload.jpg`, { type: 'image/jpeg' }));
        onChange(questionId, dataUrl);
      } catch {
        onChange(questionId, '');
      }
    } finally {
      setUploadingQuestionId('');
    }
  };

  const renderQuestion = (q: EventRegistrationQuestion) => {
    if (q.prompt.trim().toLowerCase() === MINORITY_SPECIFY_PROMPT.toLowerCase() && minorityValue !== 'Yes') {
      return null;
    }

    const value = answers[q.id];
    const list = optionsByQuestion.get(q.id) ?? [];
    const promptNorm = q.prompt.trim().toLowerCase();
    const isCompanyLogoField = promptNorm === 'company logo url' || promptNorm === 'company logo image';
    const isSpeakerHeadshotField = promptNorm === 'speaker headshot';
    const isHeadshotField = isHeadshotPrompt(q.prompt) || isSpeakerHeadshotField;
    const isSolutionCategoryField = isSolutionCategoryInterestPrompt(q.prompt);
    const isTermsPrompt = promptNorm.includes('i have read and accept the terms and conditions');
    const isCompanyDescription = promptNorm === COMPANY_DESCRIPTION_PROMPT.toLowerCase();
    const isWideQuestion = q.question_type === 'multi_select';
    const sl = (q.section_label || '').trim().toLowerCase();
    const isSolutionProviderCategory =
      q.question_type === 'multi_select' &&
      (sl === 'solution provider categories' || sl === 'solution providers categories');
    const textValue = typeof value === 'string' ? value : '';
    const charCount = isCompanyDescription ? textValue.length : 0;
    const labelText = isCompanyLogoField
      ? 'Company Logo Image'
      : isSpeakerHeadshotField
        ? 'Speaker Headshot'
        : isTermsPrompt
          ? TERMS_ACCEPTANCE_PROMPT
          : q.prompt;

    return (
      <div key={q.id} className={`${styles.question} ${isWideQuestion ? styles.questionWide : ''}`}>
        <label>
          <span className={isSolutionProviderCategory ? styles.questionLabelStrong : styles.questionLabel}>
            {labelText} {q.is_required ? <span className={styles.requiredStar}>*</span> : null}
          </span>
          {q.question_type === 'textarea' ? (
            <>
              <textarea
                value={textValue}
                maxLength={isCompanyDescription ? COMPANY_DESCRIPTION_MAX : undefined}
                required={q.is_required}
                onChange={(e) => onChange(q.id, e.target.value)}
              />
              {isCompanyDescription ? (
                <div className={styles.counterRow}>
                  <span>
                    {charCount}/{COMPANY_DESCRIPTION_MAX} (min {COMPANY_DESCRIPTION_MIN})
                  </span>
                </div>
              ) : null}
            </>
          ) : isTermsPrompt ? (
            <label className={styles.termsRow}>
              <input
                type="checkbox"
                checked={String(value || '').toLowerCase() === 'yes'}
                onChange={(e) => onChange(q.id, e.target.checked ? 'Yes' : 'No')}
              />
              <span>{TERMS_ACCEPTANCE_PROMPT}</span>
            </label>
          ) : q.question_type === 'single_select' ? (
            <select
              required={q.is_required}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(q.id, e.target.value)}
            >
              <option value="">Select</option>
              {list.map((opt) => (
                <option key={opt.id} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : q.question_type === 'multi_select' ? (
            <div className={styles.checks}>
              {(isSolutionCategoryField
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
                        onChange(
                          q.id,
                          e.target.checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value),
                        );
                      }}
                    />
                    {opt.label}
                  </label>
                );
              })}
              {isSolutionCategoryField && solutionCategories.length === 0 ? (
                <p className={styles.hint}>Solution categories will appear here once your event admin adds them.</p>
              ) : null}
            </div>
          ) : q.question_type === 'boolean' ? (
            <select
              required={q.is_required}
              value={typeof value === 'boolean' ? String(value) : ''}
              onChange={(e) => onChange(q.id, e.target.value === 'true')}
            >
              <option value="">Select</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : isCompanyLogoField || isHeadshotField ? (
            <div className={styles.uploadRow}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                disabled={Boolean(uploadingQuestionId)}
                onChange={(e) => void onUploadImage(q.id, e.target.files?.[0] ?? null)}
              />
              {typeof value === 'string' && value ? (
                <a href={value} target="_blank" rel="noreferrer">
                  View uploaded image
                </a>
              ) : null}
            </div>
          ) : (
            <input
              type={q.question_type === 'number' ? 'number' : q.question_type === 'email' ? 'email' : 'text'}
              value={textValue}
              required={q.is_required}
              onChange={(e) => onChange(q.id, e.target.value)}
            />
          )}
        </label>
      </div>
    );
  };

  return (
    <div className={styles.registrationSections}>
      {sectionGroups.map(({ sectionLabel, questions: sectionQuestions }) => (
        <section key={sectionLabel} className={styles.registrationSection} aria-labelledby={`section-${sectionLabel}`}>
          <h2 id={`section-${sectionLabel}`} className={styles.registrationSectionHeading}>
            {sectionLabel}
          </h2>
          <div className={styles.questionsGrid}>{sectionQuestions.map((q) => renderQuestion(q))}</div>
        </section>
      ))}
    </div>
  );
}
