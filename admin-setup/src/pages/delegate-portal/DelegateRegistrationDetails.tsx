import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type { EventRegistrationQuestion, EventRegistrationQuestionOption } from '../../lib/types';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

type AnswerMap = Record<string, string | string[]>;

export default function DelegateRegistrationDetails() {
  const { submission, reloadSubmission } = useOutletContext<DelegatePortalContext>();
  const [questions, setQuestions] = useState<EventRegistrationQuestion[]>([]);
  const [options, setOptions] = useState<EventRegistrationQuestionOption[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [firstName, setFirstName] = useState(submission.first_name ?? '');
  const [lastName, setLastName] = useState(submission.last_name ?? '');
  const [email, setEmail] = useState(submission.email ?? '');
  const [companyName, setCompanyName] = useState(submission.company_name ?? '');
  const [jobTitle, setJobTitle] = useState(submission.job_title ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: qRows, error: qErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .eq('form_id', submission.form_id)
          .eq('is_hidden', false)
          .order('sort_order', { ascending: true });
        if (qErr) throw qErr;
        const qList = (qRows as EventRegistrationQuestion[]) ?? [];
        if (cancelled) return;
        setQuestions(qList);

        if (qList.length > 0) {
          const { data: optRows, error: optErr } = await supabase
            .from('event_registration_question_options')
            .select('*')
            .in('question_id', qList.map((q) => q.id))
            .order('sort_order', { ascending: true });
          if (optErr) throw optErr;
          if (!cancelled) setOptions((optRows as EventRegistrationQuestionOption[]) ?? []);
        }

        const { data: aRows, error: aErr } = await supabase
          .from('event_registration_answers')
          .select('*')
          .eq('submission_id', submission.id);
        if (aErr) throw aErr;
        const map: AnswerMap = {};
        for (const row of (aRows ?? []) as Array<{ question_id: string; answer_text?: string | null; answer_json?: unknown }>) {
          if (row.answer_json != null) {
            if (Array.isArray(row.answer_json)) map[row.question_id] = row.answer_json as string[];
            else map[row.question_id] = String(row.answer_json);
          } else if (row.answer_text != null) {
            map[row.question_id] = row.answer_text;
          }
        }
        if (!cancelled) setAnswers(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load registration');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.form_id, submission.id]);

  const duplicatePrompts = useMemo(
    () => new Set(['company name', 'first name', 'last name', 'e-mail address', 'email', 'job title']),
    []
  );

  const questionsForDisplay = useMemo(
    () => questions.filter((q) => !duplicatePrompts.has(q.prompt.trim().toLowerCase())),
    [duplicatePrompts, questions]
  );

  const optionsByQuestion = useMemo(() => {
    const map = new Map<string, EventRegistrationQuestionOption[]>();
    options.forEach((opt) => {
      const list = map.get(opt.question_id) ?? [];
      list.push(opt);
      map.set(opt.question_id, list);
    });
    return map;
  }, [options]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { error: subErr } = await supabase
        .from('event_registration_submissions')
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          company_name: companyName.trim() || null,
          job_title: jobTitle.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (subErr) throw subErr;

      for (const q of questionsForDisplay) {
        const value = answers[q.id];
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        const payload = {
          submission_id: submission.id,
          question_id: q.id,
          answer_text: typeof value === 'string' ? value : null,
          answer_json: Array.isArray(value) ? value : typeof value === 'string' ? null : value,
        };
        const { error: upsErr } = await supabase.from('event_registration_answers').upsert(payload, {
          onConflict: 'submission_id,question_id',
        });
        if (upsErr) throw upsErr;
      }

      await reloadSubmission();
      setSuccess('Registration details saved.');
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading registration details…</div>;

  return (
    <div className={styles.card}>
      <h1>Registration Details</h1>
      <p className={styles.hint}>Find below your previously submitted registration details. You may make adjustments if needed.</p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}

      <div className={styles.grid2}>
        <label>
          First name <span className={styles.requiredStar}>*</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label>
          Last name <span className={styles.requiredStar}>*</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label>
          Email <span className={styles.requiredStar}>*</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Company <span className={styles.requiredStar}>*</span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
        <label>
          Job title <span className={styles.requiredStar}>*</span>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </label>
      </div>

      {questionsForDisplay.map((q, idx) => {
        const value = answers[q.id];
        const list = optionsByQuestion.get(q.id) ?? [];
        const prevSection = idx > 0 ? (questionsForDisplay[idx - 1]?.section_label ?? '').trim() : '';
        const showSection = Boolean(q.section_label?.trim() && q.section_label.trim() !== prevSection);
        return (
          <div key={q.id} className={styles.question}>
            {showSection ? <p className={styles.section}>{q.section_label}</p> : null}
            <label>
              {q.prompt} {q.is_required ? <span className={styles.requiredStar}>*</span> : null}
              {q.question_type === 'textarea' ? (
                <textarea
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              ) : q.question_type === 'single_select' ? (
                <select
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                >
                  <option value="">Select</option>
                  {list.map((opt) => (
                    <option key={opt.id} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={q.question_type === 'email' ? 'email' : q.question_type === 'number' ? 'number' : 'text'}
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              )}
            </label>
          </div>
        );
      })}

      <button type="button" className={styles.primaryBtn} disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
