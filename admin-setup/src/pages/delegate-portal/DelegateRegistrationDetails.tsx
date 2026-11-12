import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import { syncSubmissionSolutionCategories } from '../../lib/syncSolutionCategories';
import { requestMatchThemeExtraction } from '../../lib/extractMatchThemes';
import { filterRegistrationDetailsQuestions } from '../../lib/portalRegistrationDetailsQuestions';
import { mergeSectionOrder } from '../../lib/registrationSectionOrder';
import {
  contactFieldsComplete,
  identityFromAnswers,
  identityFromSubmission,
  prefillIdentityAnswers,
  requiredQuestionsComplete,
} from '../../lib/registrationIdentitySync';
import PortalRegistrationQuestionList from '../../components/PortalRegistrationQuestionList';
import { findRegistrationHeadshotUrl, syncUserAvatarFromUrl } from '../../lib/registrationHeadshot';
import { isRegistrationQuestionVisible } from '../../lib/registrationQuestionConditions';
import type { EventRegistrationQuestion, EventRegistrationQuestionOption } from '../../lib/types';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

type AnswerMap = Record<string, string | string[] | boolean>;

export default function DelegateRegistrationDetails() {
  const { event, submission, reloadSubmission } = useOutletContext<DelegatePortalContext>();
  const [questions, setQuestions] = useState<EventRegistrationQuestion[]>([]);
  const [options, setOptions] = useState<EventRegistrationQuestionOption[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!success && !error) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [success, error]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: qRows, error: qErr } = await supabase
          .from('event_registration_questions')
          .select('*')
          .eq('form_id', submission.form_id)
          .order('sort_order', { ascending: true });
        if (qErr) throw qErr;
        const qList = (qRows as EventRegistrationQuestion[]) ?? [];
        if (cancelled) return;
        setQuestions(qList);

        const { data: formRow, error: formErr } = await supabase
          .from('event_registration_forms')
          .select('audience, section_order')
          .eq('id', submission.form_id)
          .single();
        if (formErr) throw formErr;
        if (!cancelled && formRow) {
          setSectionOrder(
            mergeSectionOrder(
              { audience: 'attendee', section_order: (formRow as { section_order?: string[] }).section_order },
              qList,
            ),
          );
        }

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
        for (const row of (aRows ?? []) as Array<{
          question_id: string;
          answer_text?: string | null;
          answer_json?: unknown;
          answer_boolean?: boolean | null;
          answer_number?: number | null;
        }>) {
          if (row.answer_json != null) {
            if (Array.isArray(row.answer_json)) {
              map[row.question_id] = row.answer_json as string[];
            } else if (typeof row.answer_json === 'boolean') {
              map[row.question_id] = row.answer_json;
            } else {
              map[row.question_id] = String(row.answer_json);
            }
          } else if (row.answer_boolean != null) {
            map[row.question_id] = row.answer_boolean;
          } else if (row.answer_number != null) {
            map[row.question_id] = String(row.answer_number);
          } else if (row.answer_text != null) {
            map[row.question_id] = row.answer_text;
          }
        }
        if (!cancelled) {
          setAnswers(prefillIdentityAnswers(qList, map, submission));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load registration');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.form_id, submission.id, submission]);

  const questionsForDisplay = useMemo(
    () =>
      filterRegistrationDetailsQuestions('attendee', questions).filter((question) =>
        isRegistrationQuestionVisible(question, answers),
      ),
    [answers, questions],
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

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const identity = identityFromAnswers(
        questionsForDisplay,
        answers,
        identityFromSubmission(submission),
      );
      const profileComplete =
        contactFieldsComplete(identity) && requiredQuestionsComplete(questionsForDisplay, answers);
      const profileJustCompleted = profileComplete && !submission.profile_complete;

      const { error: subErr } = await supabase
        .from('event_registration_submissions')
        .update({
          first_name: identity.firstName.trim() || null,
          last_name: identity.lastName.trim() || null,
          email: identity.email.trim() || null,
          company_name: identity.companyName.trim() || null,
          job_title: identity.jobTitle.trim() || null,
          profile_complete: profileComplete,
          ...(profileJustCompleted ? { matching_opt_in: true } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (subErr) throw subErr;

      const hiddenConditionalQuestionIds = questions
        .filter(
          (question) =>
            question.condition_question_id &&
            !isRegistrationQuestionVisible(question, answers),
        )
        .map((question) => question.id);
      if (hiddenConditionalQuestionIds.length > 0) {
        const { error: deleteHiddenErr } = await supabase
          .from('event_registration_answers')
          .delete()
          .eq('submission_id', submission.id)
          .in('question_id', hiddenConditionalQuestionIds);
        if (deleteHiddenErr) throw deleteHiddenErr;
      }

      for (const q of questionsForDisplay) {
        const value = answers[q.id];
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        const payload = {
          submission_id: submission.id,
          question_id: q.id,
          answer_text: typeof value === 'string' ? value : null,
          answer_json: Array.isArray(value) ? value : typeof value === 'boolean' ? value : null,
        };
        const { error: upsErr } = await supabase.from('event_registration_answers').upsert(payload, {
          onConflict: 'submission_id,question_id',
        });
        if (upsErr) throw upsErr;
      }

      await syncSubmissionSolutionCategories(submission.id);
      requestMatchThemeExtraction(submission.id);
      const headshotUrl = findRegistrationHeadshotUrl(questionsForDisplay, answers);
      if (headshotUrl && submission.user_id) {
        try {
          await syncUserAvatarFromUrl(submission.user_id, headshotUrl);
        } catch {
          /* best-effort */
        }
      }
      await reloadSubmission();
      const message = profileComplete
        ? 'Your registration details were saved successfully. Profile complete.'
        : 'Your registration details were saved successfully.';
      setSuccess(message);
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
      <p className={styles.detailsIntro}>
        Find below your previously submitted registration details. You may make adjustments if needed.
      </p>
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

      <PortalRegistrationQuestionList
        eventId={event.id}
        formId={submission.form_id}
        audience="attendee"
        questions={questionsForDisplay}
        options={options}
        answers={answers}
        onChange={setAnswer}
        profileUserId={submission.user_id}
        sectionOrder={sectionOrder}
      />

      <div className={styles.saveFooter}>
        <button type="button" className={styles.primaryBtn} disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
