import type { ReactNode } from 'react';
import { OVERALL_LABEL, type CheckStatus, type ReadinessCheck } from '../lib/readiness';
import styles from './ReadinessChecks.module.css';

const BANNER_CLASS: Record<'ok' | 'warn' | 'fail', string | undefined> = {
  ok: styles.bannerOk,
  warn: styles.bannerWarn,
  fail: styles.bannerFail,
};

interface OverallBannerProps {
  overall: 'ok' | 'warn' | 'fail';
  text: string;
  title?: string;
  action?: ReactNode;
}

export function OverallBanner({ overall, text, title, action }: OverallBannerProps) {
  return (
    <div className={`${styles.banner} ${BANNER_CLASS[overall]}`} role="status">
      <div>
        <p className={styles.bannerTitle}>{title ?? OVERALL_LABEL[overall]}</p>
        <p className={styles.bannerText}>{text}</p>
      </div>
      {action}
    </div>
  );
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'OK',
  warn: 'Check',
  fail: 'Fix',
  info: 'Info',
  not_set_up: 'Not set up',
};

const STATUS_CLASS: Record<CheckStatus, string | undefined> = {
  ok: styles.statusOk,
  warn: styles.statusWarn,
  fail: styles.statusFail,
  info: styles.statusInfo,
  not_set_up: styles.statusInfo,
};

interface StatusPillProps {
  status: CheckStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`${styles.pill} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

interface ReadinessChecksProps {
  checks: ReadinessCheck[];
}

const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, not_set_up: 2, info: 3, ok: 4 };

export default function ReadinessChecks({ checks }: ReadinessChecksProps) {
  const groups: { name: string; checks: ReadinessCheck[] }[] = [];
  for (const check of checks) {
    const existing = groups.find((g) => g.name === check.group);
    if (existing) existing.checks.push(check);
    else groups.push({ name: check.group, checks: [check] });
  }

  return (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.name} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.name}</h2>
          <ul className={styles.list}>
            {[...group.checks]
              .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
              .map((check) => (
                <li key={check.id} className={styles.row}>
                  <StatusPill status={check.status} />
                  <div className={styles.body}>
                    <span className={styles.label}>{check.label}</span>
                    <span className={styles.detail}>{check.detail}</span>
                    {check.items && check.items.length > 0 && check.status !== 'ok' ? (
                      <ul className={styles.items}>
                        {check.items.map((item, idx) => (
                          <li key={`${check.id}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
