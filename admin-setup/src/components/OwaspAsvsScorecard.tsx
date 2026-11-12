import { useMemo, useState } from 'react';
import scorecard from '../data/owaspAsvsScorecard.json';
import styles from './OwaspAsvsScorecard.module.css';

type Category = {
  id: string;
  name: string;
  score: number;
  max: number;
  status: string;
  note: string;
  whyScore: string;
  strengths: string[];
  gaps: string[];
  relatedFindings: string[];
};

type Finding = { id: string; title: string };

type Severity = 'critical' | 'high' | 'medium' | 'low';

type Scorecard = {
  standard: string;
  auditId: string;
  auditedAt: string;
  summary: { critical: number; high: number; medium: number; low: number };
  categories: Category[];
  findings: Record<Severity, Finding[]>;
  openHigh?: Finding[];
  nextSteps: string[];
};

const data = scorecard as Scorecard;

const SEVERITY_META: { key: Severity; label: string; chipClass?: string }[] = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High', chipClass: styles.high },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

function overallPercent(categories: Category[]): number {
  const earned = categories.reduce((sum, c) => sum + c.score, 0);
  const max = categories.reduce((sum, c) => sum + c.max, 0);
  if (max <= 0) return 0;
  return Math.round((earned / max) * 100);
}

function statusLabel(status: string): string {
  if (status === 'pass') return 'Pass';
  if (status === 'fail') return 'Fail';
  return 'Partial';
}

function findingsFor(severity: Severity): Finding[] {
  if (data.findings?.[severity]) return data.findings[severity];
  if (severity === 'high' && data.openHigh) return data.openHigh;
  return [];
}

function allFindings(): Finding[] {
  return (['critical', 'high', 'medium', 'low'] as Severity[]).flatMap((s) => findingsFor(s));
}

/** Platform-admin OWASP ASVS scorecard (from latest written audit JSON). */
export default function OwaspAsvsScorecard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const pct = overallPercent(data.categories);
  const earned = data.categories.reduce((sum, c) => sum + c.score, 0);
  const max = data.categories.reduce((sum, c) => sum + c.max, 0);
  const tone = pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'low';

  const selected = useMemo(
    () => data.categories.find((c) => c.id === selectedId) ?? null,
    [selectedId],
  );

  const severityFindings = useMemo(
    () => (severityFilter ? findingsFor(severityFilter) : []),
    [severityFilter],
  );

  const findingTitle = (id: string) =>
    allFindings().find((f) => f.id === id)?.title ?? id;

  const toggleSeverity = (key: Severity) => {
    setSelectedId(null);
    setSeverityFilter((prev) => (prev === key ? null : key));
  };

  return (
    <section className={styles.section} id="owasp-asvs" aria-label="OWASP ASVS scorecard">
      <div className={styles.headerRow}>
        <div>
          <p className={styles.meta}>
            {data.standard} · Audit {data.auditedAt} · Snapshot from latest security audit (not live
            auto-scanned). Click a severity chip or category for details.
          </p>
        </div>
        <div className={`${styles.scoreBadge} ${styles[tone]}`} aria-label={`Overall score ${pct} percent`}>
          <span className={styles.scoreValue}>{pct}%</span>
          <span className={styles.scoreSub}>
            {earned}/{max} category points
          </span>
        </div>
      </div>

      <div className={styles.summaryRow} role="group" aria-label="Findings by severity">
        {SEVERITY_META.map(({ key, label, chipClass }) => {
          const count = data.summary[key];
          const active = severityFilter === key;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.summaryChip} ${chipClass ?? ''} ${active ? styles.summaryChipActive : ''}`}
              onClick={() => toggleSeverity(key)}
              aria-pressed={active}
              aria-label={`Show ${count} ${label} findings`}
            >
              <strong>{count}</strong> {label}
            </button>
          );
        })}
      </div>

      {severityFilter ? (
        <div className={styles.detail} id="owasp-severity-detail" role="region" aria-label={`${severityFilter} findings`}>
          <div className={styles.detailHeader}>
            <div>
              <h3>
                {SEVERITY_META.find((s) => s.key === severityFilter)?.label} findings (
                {severityFindings.length})
              </h3>
              <p className={styles.detailStatus}>
                {severityFindings.length === 0
                  ? 'None open at this severity.'
                  : 'From the latest written ASVS audit.'}
              </p>
            </div>
            <button type="button" className={styles.detailClose} onClick={() => setSeverityFilter(null)}>
              Close
            </button>
          </div>
          {severityFindings.length > 0 ? (
            <ul className={styles.findingList}>
              {severityFindings.map((f) => (
                <li key={f.id}>
                  <strong>{f.id}</strong> — {f.title}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={styles.categoryGrid}>
        {data.categories.map((c) => {
          const bar = Math.round((c.score / c.max) * 100);
          const active = selectedId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className={`${styles.categoryCard} ${active ? styles.categoryCardActive : ''}`}
              onClick={() => {
                setSeverityFilter(null);
                setSelectedId(active ? null : c.id);
              }}
              aria-expanded={active}
              aria-controls={active ? 'owasp-category-detail' : undefined}
            >
              <div className={styles.categoryTop}>
                <h3>{c.name}</h3>
                <span className={styles.categoryScore}>
                  {c.score}/{c.max} · {statusLabel(c.status)}
                </span>
              </div>
              <div className={styles.barTrack} aria-hidden>
                <div className={styles.barFill} style={{ width: `${bar}%` }} />
              </div>
              <p className={styles.categoryNote}>{c.note}</p>
              <span className={styles.cardHint}>{active ? 'Hide details' : 'View why'}</span>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className={styles.detail} id="owasp-category-detail" role="region" aria-label={`${selected.name} details`}>
          <div className={styles.detailHeader}>
            <div>
              <h3>
                {selected.name} — {selected.score}/{selected.max}
              </h3>
              <p className={styles.detailStatus}>{statusLabel(selected.status)}</p>
            </div>
            <button type="button" className={styles.detailClose} onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <p className={styles.why}>{selected.whyScore}</p>
          {selected.strengths.length > 0 ? (
            <div className={styles.detailBlock}>
              <h4>What is working</h4>
              <ul>
                {selected.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {selected.gaps.length > 0 ? (
            <div className={styles.detailBlock}>
              <h4>Why points were held back</h4>
              <ul>
                {selected.gaps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {selected.relatedFindings.length > 0 ? (
            <div className={styles.detailBlock}>
              <h4>Related findings</h4>
              <ul>
                {selected.relatedFindings.map((id) => (
                  <li key={id}>
                    <strong>{id}</strong> — {findingTitle(id)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {data.nextSteps.length > 0 ? (
        <div className={styles.nextSteps}>
          <h3>Next steps</h3>
          <ol>
            {data.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
