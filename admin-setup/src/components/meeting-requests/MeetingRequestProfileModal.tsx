import { useEffect, useMemo, useState } from 'react';
import {
  INTEREST_LEVEL_OPTIONS,
  loadMeetingRequestTargetProfile,
  type MeetingRequestTarget,
  type MeetingRequestTargetProfile,
} from '../../lib/meetingRequests';
import styles from './MeetingRequests.module.css';

interface Props {
  eventId: string;
  submissionId: string;
  target: MeetingRequestTarget | null;
  onClose: () => void;
}

function groupProfileAnswers(answers: MeetingRequestTargetProfile['answers']) {
  const groups: Array<{ sectionLabel: string | null; answers: MeetingRequestTargetProfile['answers'] }> = [];
  const indexByKey = new Map<string, number>();

  for (const answer of answers) {
    const sectionLabel = answer.section_label?.trim() || null;
    const key = sectionLabel?.toLowerCase() ?? '__general__';
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ sectionLabel, answers: [answer] });
    } else {
      groups[existingIndex]!.answers.push(answer);
    }
  }

  return groups;
}

function renderAnswerValue(answer: MeetingRequestTargetProfile['answers'][number]) {
  const value = answer.value?.trim() || '—';
  const promptNorm = answer.prompt.trim().toLowerCase();
  const isPhotoField =
    promptNorm.includes('headshot') || promptNorm.includes('photo') || promptNorm.includes('logo');
  if (isPhotoField && value !== '—' && /^https?:\/\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        <img src={value} alt="" className={styles.profilePhoto} />
      </a>
    );
  }
  return <span className={styles.profileFieldValue}>{value}</span>;
}

export default function MeetingRequestProfileModal({ eventId, submissionId, target, onClose }: Props) {
  const [profile, setProfile] = useState<MeetingRequestTargetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await loadMeetingRequestTargetProfile(eventId, submissionId, target.id);
        if (!cancelled) setProfile(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, submissionId, target]);

  const answerSections = useMemo(
    () => (profile ? groupProfileAnswers(profile.answers) : []),
    [profile],
  );

  if (!target) return null;

  const logoUrl =
    target.logo_url ||
    profile?.answers.find((a) => a.prompt.toLowerCase().includes('company logo'))?.value ||
    null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>Profile</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          {loading ? <p className={styles.hint}>Loading profile…</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          {!loading && profile ? (
            <>
              <div className={styles.profileHero}>
                {logoUrl ? <img src={logoUrl} alt="" className={styles.profileLogo} /> : null}
                <div>
                  <h3 style={{ margin: '0 0 6px' }}>{profile.company_name ?? '—'}</h3>
                  <p className={styles.profileMeta}>
                    {[profile.first_name, profile.last_name].filter(Boolean).join(' ')}
                    {profile.job_title ? ` · ${profile.job_title}` : ''}
                  </p>
                </div>
              </div>
              {profile.categories.length > 0 ? (
                <section>
                  <h4 className={styles.modalSectionTitle}>Solution categories</h4>
                  <div className={styles.categoryList}>
                    {profile.categories.map((cat) => (
                      <span key={cat} className={styles.categoryChip}>
                        {cat}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}
              {answerSections.map((section) => (
                <section key={section.sectionLabel ?? 'general'}>
                  {section.sectionLabel ? (
                    <h4 className={styles.modalSectionTitle}>{section.sectionLabel}</h4>
                  ) : null}
                  <div className={styles.profileGrid}>
                    {section.answers.map((answer) => (
                      <div key={answer.prompt}>
                        <span className={styles.profileFieldLabel}>{answer.prompt}</span>
                        {renderAnswerValue(answer)}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface AddModalProps {
  target: MeetingRequestTarget | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (interestLevel: (typeof INTEREST_LEVEL_OPTIONS)[number]['value']) => void;
}

export function MeetingRequestAddModal({ target, saving, error, onClose, onSubmit }: AddModalProps) {
  const [interestLevel, setInterestLevel] = useState<(typeof INTEREST_LEVEL_OPTIONS)[number]['value']>('medium');

  if (!target) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>Add Request</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <section>
            <h4 className={styles.modalSectionTitle}>Request</h4>
            <p className={styles.profileMeta}>
              <strong>{target.company_name ?? '—'}</strong>
              {[target.first_name, target.last_name].filter(Boolean).length > 0
                ? ` · ${[target.first_name, target.last_name].filter(Boolean).join(' ')}`
                : ''}
            </p>
          </section>
          <section>
            <h4 className={styles.modalSectionTitle}>Ranking</h4>
            <p className={styles.profileFieldLabel}>* Interest Level</p>
            <div className={styles.radioGroup}>
              {INTEREST_LEVEL_OPTIONS.map((opt) => (
                <label key={opt.value} className={styles.radioItem}>
                  <input
                    type="radio"
                    name="interestLevel"
                    value={opt.value}
                    checked={interestLevel === opt.value}
                    onChange={() => setInterestLevel(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </section>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={saving}
              onClick={() => onSubmit(interestLevel)}
            >
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditInterestModalProps {
  companyLabel: string;
  initialLevel: (typeof INTEREST_LEVEL_OPTIONS)[number]['value'];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (interestLevel: (typeof INTEREST_LEVEL_OPTIONS)[number]['value']) => void;
}

export function MeetingRequestEditInterestModal({
  companyLabel,
  initialLevel,
  saving,
  error,
  onClose,
  onSubmit,
}: EditInterestModalProps) {
  const [interestLevel, setInterestLevel] = useState(initialLevel);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <h2>Update Interest</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.profileMeta}>{companyLabel}</p>
          <div className={styles.radioGroup}>
            {INTEREST_LEVEL_OPTIONS.map((opt) => (
              <label key={opt.value} className={styles.radioItem}>
                <input
                  type="radio"
                  name="editInterestLevel"
                  value={opt.value}
                  checked={interestLevel === opt.value}
                  onChange={() => setInterestLevel(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={saving}
              onClick={() => onSubmit(interestLevel)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
