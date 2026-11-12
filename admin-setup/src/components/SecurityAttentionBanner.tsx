import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import styles from './SecurityAttentionBanner.module.css';

const DISMISS_KEY = 'cadmin.securityAttentionDismissed';

type OverviewCounts = {
  brute_force_alerts_24h?: number;
  suspicious_users?: number;
  orphan_accounts?: number;
  failed_logins_7d?: number;
};

type AttentionState = {
  fingerprint: string;
  reasons: string[];
};

function buildAttention(counts: OverviewCounts, anomalyHits: number): AttentionState | null {
  const reasons: string[] = [];
  const brute = counts.brute_force_alerts_24h ?? 0;
  const suspicious = counts.suspicious_users ?? 0;
  const orphans = counts.orphan_accounts ?? 0;

  if (brute > 0) {
    reasons.push(
      brute === 1 ? '1 brute-force alert in the last 24 hours' : `${brute} brute-force alerts in the last 24 hours`
    );
  }
  if (anomalyHits > 0) {
    reasons.push(
      anomalyHits === 1
        ? '1 active login attack pattern detected'
        : `${anomalyHits} active login attack patterns detected`
    );
  }
  if (suspicious > 0) {
    reasons.push(
      suspicious === 1 ? '1 suspicious user needs review' : `${suspicious} suspicious users need review`
    );
  }
  // Only surface orphans when there are several (avoid noise from portal-only accounts)
  if (orphans >= 5) {
    reasons.push(`${orphans} accounts with no event membership`);
  }

  if (reasons.length === 0) return null;
  const fingerprint = `b${brute}|a${anomalyHits}|s${suspicious}|o${orphans}`;
  return { fingerprint, reasons };
}

function readDismissedFingerprint(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedFingerprint(fp: string) {
  try {
    sessionStorage.setItem(DISMISS_KEY, fp);
  } catch {
    /* ignore */
  }
}

/** Platform-admin only banner when security audit needs attention. */
export default function SecurityAttentionBanner({ enabled }: { enabled: boolean }) {
  const location = useLocation();
  const onAuditPage = location.pathname.startsWith('/platform/audit');
  const [attention, setAttention] = useState<AttentionState | null>(null);
  const [dismissedFp, setDismissedFp] = useState<string | null>(() => readDismissedFingerprint());

  useEffect(() => {
    if (!enabled) {
      setAttention(null);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const [overviewRes, bruteRes] = await Promise.all([
          supabase.rpc('get_platform_security_overview'),
          supabase.rpc('list_brute_force_anomalies', { p_hours: 24 }),
        ]);
        if (cancelled) return;
        if (overviewRes.error) return;

        const overview = overviewRes.data as {
          error?: string;
          counts?: OverviewCounts;
        } | null;
        if (!overview || overview.error || !overview.counts) return;

        const brutePack = bruteRes.data as {
          error?: string;
          email_targets?: unknown[];
          ip_targets?: unknown[];
          ip_scans?: unknown[];
        } | null;
        const anomalyHits =
          (Array.isArray(brutePack?.email_targets) ? brutePack!.email_targets!.length : 0) +
          (Array.isArray(brutePack?.ip_targets) ? brutePack!.ip_targets!.length : 0) +
          (Array.isArray(brutePack?.ip_scans) ? brutePack!.ip_scans!.length : 0);

        setAttention(buildAttention(overview.counts, anomalyHits));
      } catch {
        /* non-blocking */
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  const visible = useMemo(() => {
    if (!enabled || !attention || onAuditPage) return false;
    if (dismissedFp && dismissedFp === attention.fingerprint) return false;
    return true;
  }, [enabled, attention, onAuditPage, dismissedFp]);

  if (!visible || !attention) return null;

  const summary = attention.reasons.slice(0, 2).join(' · ');

  return (
    <div className={styles.banner} role="status">
      <div className={styles.body}>
        <strong className={styles.title}>Security attention needed</strong>
        <span className={styles.detail}>{summary}</span>
        <Link to="/platform/audit" className={styles.link}>
          Open Security audit →
        </Link>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => {
          writeDismissedFingerprint(attention.fingerprint);
          setDismissedFp(attention.fingerprint);
        }}
        aria-label="Dismiss security banner"
      >
        Dismiss
      </button>
    </div>
  );
}
