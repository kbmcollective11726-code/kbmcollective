import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isMatchScoringSetupApproved,
  proposeMatchScoringSetup,
  type MatchConfigWeights,
  type ScoringDimensionProposal,
} from '../lib/matchScoringSetup';
import {
  extractMatchThemesForEvent,
  isMatchAiThemesEnabled,
  setMatchAiThemesEnabled,
} from '../lib/extractMatchThemes';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { supabase } from '../lib/supabase';
import type { EventRegistrationForm, EventRegistrationQuestion } from '../lib/types';
import styles from '../pages/EventMatchmaking.module.css';

interface Props {
  eventId: string;
  forms: EventRegistrationForm[];
  questions: EventRegistrationQuestion[];
  currentWeights: MatchConfigWeights;
  isPlatformAdmin?: boolean;
  onApproved: (weights: MatchConfigWeights, enabledQuestionIds: string[]) => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
}

function StatusPill({ status }: { status: ScoringDimensionProposal['status'] }) {
  const tone =
    status === 'ready' ? 'success' : status === 'partial' ? 'warn' : 'muted';
  const label = status === 'ready' ? 'Ready' : status === 'partial' ? 'Partial' : 'Missing';
  return <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{label}</span>;
}

export default function MatchmakingScoringSetup({
  eventId,
  forms,
  questions,
  currentWeights,
  isPlatformAdmin = false,
  onApproved,
  onError,
  onNotice,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const themeBackfillKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isMatchAiThemesEnabled().then((on) => {
      if (!cancelled) setAiEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const proposal = useMemo(
    () => proposeMatchScoringSetup({ forms, questions }),
    // scanKey forces recompute after approve updates local question flags
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forms, questions, scanKey],
  );

  const matchingEnabledCount = useMemo(
    () => questions.filter((q) => q.used_in_matching === true && !q.is_hidden).length,
    [questions],
  );

  const isApproved = isMatchScoringSetupApproved({
    forms,
    questions,
    currentWeights,
  });

  useEffect(() => {
    // Collapse to the simple weight summary once approved.
    setShowDetails(!isApproved);
  }, [isApproved]);

  const activeWeights = useMemo(() => {
    if (isApproved) return currentWeights;
    return proposal.weights;
  }, [isApproved, currentWeights, proposal.weights]);

  const weightRows = useMemo(() => {
    return proposal.dimensions
      .map((dim) => ({
        id: dim.id,
        label: dim.label,
        weight: activeWeights[dim.weightKey] ?? dim.recommendedWeight,
        status: dim.status,
      }))
      .filter((row) => row.weight > 0 || row.status === 'ready');
  }, [proposal.dimensions, activeWeights]);

  /** Quietly backfill goal themes for existing registrants when AI is on. */
  const runThemeBackfill = async (opts?: { quiet?: boolean }) => {
    if (!eventId) return;
    const quiet = opts?.quiet !== false;
    setAiBusy(true);
    try {
      const result = await extractMatchThemesForEvent(eventId, { limit: 60, force: false });
      if (result.disabled || result.error) {
        if (!quiet && result.error) onError(result.error);
        return;
      }
      if (!quiet && result.processed > 0) {
        onNotice?.(
          `Updated goal themes for ${result.processed} registration${
            result.processed === 1 ? '' : 's'
          }.`,
        );
      }
    } catch {
      /* quiet — open-text scoring still works without themes */
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (!aiEnabled || !eventId) return;
    const key = `${eventId}:on`;
    if (themeBackfillKey.current === key) return;
    themeBackfillKey.current = key;
    void runThemeBackfill({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when AI becomes available for this event
  }, [aiEnabled, eventId]);

  const approve = async () => {
    if (!eventId) return;
    if (proposal.readyCount === 0) {
      onError('No scoring signals found on the active vendor and delegate forms yet.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const { error: upsertErr } = await supabase.from('event_match_config').upsert({
        event_id: eventId,
        ...proposal.weights,
        updated_at: new Date().toISOString(),
      });
      if (upsertErr) throw upsertErr;

      const enableSet = new Set(proposal.enableMatchingQuestionIds);
      const scorable = questions.filter((q) => {
        const form = forms.find((f) => f.id === q.form_id);
        return form && (form.audience === 'vendor' || form.audience === 'attendee') && !q.is_hidden;
      });

      for (const q of scorable) {
        const next = enableSet.has(q.id);
        if (Boolean(q.used_in_matching) === next) continue;
        const { error } = await supabase
          .from('event_registration_questions')
          .update({ used_in_matching: next, updated_at: new Date().toISOString() })
          .eq('id', q.id);
        if (error) throw error;
      }

      onApproved(proposal.weights, proposal.enableMatchingQuestionIds);
      setScanKey((k) => k + 1);
      setShowDetails(false);
      onNotice?.(
        `Scoring setup approved — ${proposal.readyCount} signal${
          proposal.readyCount === 1 ? '' : 's'
        } active for matches.`,
      );
      if (aiEnabled) {
        themeBackfillKey.current = null;
        void runThemeBackfill({ quiet: true });
      }
    } catch (cause) {
      onError(postgrestErrorMessage(cause) || 'Could not approve scoring setup');
    } finally {
      setBusy(false);
    }
  };

  const toggleAi = async (next: boolean) => {
    if (!isPlatformAdmin) return;
    setAiBusy(true);
    onError('');
    try {
      await setMatchAiThemesEnabled(next);
      setAiEnabled(next);
      if (next) {
        themeBackfillKey.current = null;
        onNotice?.(
          'AI goal themes enabled. Existing answers are being updated automatically; new portal saves will too.',
        );
        void runThemeBackfill({ quiet: true });
      } else {
        onNotice?.('AI goal themes disabled. Open-text scoring uses shared words only.');
      }
    } catch (cause) {
      onError(postgrestErrorMessage(cause) || 'Could not update AI theme setting');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <section id="intelligent-scoring-setup" className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>Intelligent scoring</h2>
        <span
          className={`${styles.statusBadge} ${
            styles[isApproved ? 'statusBadge_success' : 'statusBadge_warn']
          }`}
        >
          {isApproved ? 'Approved' : 'Needs review'}
        </span>
      </div>

      {isApproved && !showDetails ? (
        <>
          <p className={styles.sectionLead}>
            Scoring is approved for this event. Match scores use these weights from your forms.
          </p>

          <div className={styles.aiThemeToggleBar}>
            <div>
              <strong>AI goal themes</strong>
              <p className={styles.hint}>
                {aiEnabled
                  ? aiBusy
                    ? 'On — updating themes from existing answers…'
                    : 'On — themes fill automatically from “hoping to…” answers.'
                  : 'Off — open-text scoring uses shared words only.'}
              </p>
            </div>
            {isPlatformAdmin ? (
              <label className={styles.aiThemeSwitch}>
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  disabled={aiBusy || busy}
                  onChange={(e) => void toggleAi(e.target.checked)}
                />
                <span>{aiEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            ) : (
              <span
                className={`${styles.statusBadge} ${
                  styles[aiEnabled ? 'statusBadge_success' : 'statusBadge_muted']
                }`}
              >
                {aiEnabled ? 'Enabled' : 'Disabled'}
              </span>
            )}
          </div>

          <ul className={styles.scoringWeightSummary}>
            {weightRows.map((row) => (
              <li key={row.id}>
                <span>{row.label}</span>
                <strong>{row.weight}</strong>
              </li>
            ))}
          </ul>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={busy}
              onClick={() => setShowDetails(true)}
            >
              Review setup
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.sectionLead}>
            We scanned your vendor and delegate forms and proposed scoring signals. Approve once —
            matching uses this for every pair. Optional AI only helps with open-text goals (small
            bonus), and runs automatically when enabled.
          </p>

          <div className={styles.aiThemeToggleBar}>
            <div>
              <strong>AI goal themes</strong>
              <p className={styles.hint}>
                {aiEnabled
                  ? aiBusy
                    ? 'On — updating themes from existing answers…'
                    : 'On — themes fill automatically from “hoping to…” answers (no extra steps).'
                  : 'Off — open-text scoring uses shared words only.'}
              </p>
            </div>
            {isPlatformAdmin ? (
              <label className={styles.aiThemeSwitch}>
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  disabled={aiBusy || busy}
                  onChange={(e) => void toggleAi(e.target.checked)}
                />
                <span>{aiEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            ) : (
              <span
                className={`${styles.statusBadge} ${
                  styles[aiEnabled ? 'statusBadge_success' : 'statusBadge_muted']
                }`}
              >
                {aiEnabled ? 'Enabled' : 'Disabled'}
              </span>
            )}
          </div>

          <div className={styles.scoringSetupMeta}>
            <span>{proposal.summary}</span>
            <span className={styles.hint}>
              {matchingEnabledCount} question{matchingEnabledCount === 1 ? '' : 's'} currently marked
              for matching
            </span>
          </div>

          <div className={styles.scoringDimList}>
            {proposal.dimensions.map((dim) => (
              <div key={dim.id} className={styles.scoringDimCard}>
                <div className={styles.scoringDimHeader}>
                  <strong>{dim.label}</strong>
                  <StatusPill status={dim.status} />
                </div>
                <p className={styles.hint}>{dim.detail}</p>
                <div className={styles.scoringDimWeight}>
                  Weight: <strong>{dim.recommendedWeight}</strong>
                  {dim.recommendedWeight === 0 && dim.status !== 'ready' ? ' (off)' : ''}
                </div>
                {(dim.vendorQuestions.length > 0 || dim.delegateQuestions.length > 0) && (
                  <ul className={styles.scoringDimQuestions}>
                    {dim.vendorQuestions.map((q) => (
                      <li key={q.id}>
                        <span className={styles.scoringSideTag}>Vendor</span> {q.prompt}
                        <span className={styles.hint}> · {q.formName}</span>
                      </li>
                    ))}
                    {dim.delegateQuestions.map((q) => (
                      <li key={`d-${q.id}`}>
                        <span className={styles.scoringSideTagDelegate}>Delegate</span> {q.prompt}
                        <span className={styles.hint}> · {q.formName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={busy || proposal.readyCount === 0}
              onClick={() => void approve()}
            >
              {busy ? 'Approving…' : isApproved ? 'Re-approve setup' : 'Approve scoring setup'}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={busy}
              onClick={() => setScanKey((k) => k + 1)}
            >
              Re-scan forms
            </button>
            {isApproved ? (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={busy}
                onClick={() => setShowDetails(false)}
              >
                Done
              </button>
            ) : null}
          </div>
          {!isPlatformAdmin ? (
            <p className={styles.hint}>Only a platform admin can enable or disable AI goal themes.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
