import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import ReadinessChecks, { OverallBanner, StatusPill } from '../components/ReadinessChecks';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import {
  fetchOutsideChecks,
  fetchPlatformHealthSnapshot,
  worstStatus,
  type CheckStatus,
  type HealthJob,
  type OutsideChecks,
  type PlatformHealthSnapshot,
  type ReadinessCheck,
} from '../lib/readiness';
import styles from './PlatformHealth.module.css';

const JOB_LABELS: Record<string, string> = {
  'notify-b2b-meeting-soon': '1:1 meeting reminders',
  'notify-event-starting-soon': 'Session reminders',
  'process-scheduled-announcements': 'Scheduled announcements',
  'nudge-b2b-meeting-feedback': 'Meeting feedback prompts',
  'auto-deactivate-events': 'Turn off ended events',
  'process-orphan-signup-alerts': 'New sign-up alerts',
  'process-orphan-auto-deactivate': 'Unused account cleanup',
  'process-security-anomalies': 'Security monitoring',
  'purge-expired-security-logs': 'Security log cleanup',
};

/** Jobs whose minute field is `*` or `*\/N` (N ≤ 10) run every few minutes; the rest run daily or hourly. */
function isFrequentJob(schedule: string): boolean {
  const minute = schedule.trim().split(/\s+/)[0] ?? '';
  if (minute === '*') return true;
  const m = minute.match(/^\*\/(\d+)$/);
  return !!m && Number(m[1]) <= 10;
}

function jobCheck(job: HealthJob): ReadinessCheck {
  const label = JOB_LABELS[job.name] ?? job.name;
  const lastRunMs = job.last_run ? Date.parse(job.last_run) : NaN;
  const staleAfterMs = isFrequentJob(job.schedule) ? 15 * 60 * 1000 : 26 * 60 * 60 * 1000;
  const stale = !Number.isFinite(lastRunMs) || Date.now() - lastRunMs > staleAfterMs;
  let status: CheckStatus = 'ok';
  let detail = `${job.runs_24h} runs in the last 24 hours, none failed.`;
  if (!job.active) {
    status = 'fail';
    detail = 'Turned off.';
  } else if (stale) {
    status = 'fail';
    detail = Number.isFinite(lastRunMs)
      ? `Has not run since ${new Date(lastRunMs).toLocaleString()}.`
      : 'Has never run.';
  } else if (job.failed_24h > 0) {
    status = job.last_status === 'failed' ? 'fail' : 'warn';
    detail = `${job.failed_24h} of ${job.runs_24h} runs failed in the last 24 hours.${job.last_error ? ` Last error: ${job.last_error}` : ''}`;
  }
  return { id: `job-${job.name}`, group: 'Background jobs', label, status, detail };
}

function serverChecks(s: PlatformHealthSnapshot): ReadinessCheck[] {
  const connPct = s.database.max_connections > 0 ? (s.database.connections / s.database.max_connections) * 100 : 0;
  return [
    {
      id: 'server-calls',
      group: 'Server',
      label: 'Server calls from scheduled jobs',
      status: s.server_calls.failed_24h > 0 ? 'warn' : 'ok',
      detail:
        s.server_calls.failed_24h > 0
          ? `${s.server_calls.failed_24h} of ${s.server_calls.total_24h} calls failed in the last 24 hours.`
          : `${s.server_calls.total_24h} calls in the last 24 hours, none failed.`,
    },
    {
      id: 'db-connections',
      group: 'Server',
      label: 'Database load',
      status: connPct >= 80 ? 'warn' : 'ok',
      detail: `${s.database.connections} of ${s.database.max_connections} connections in use (${Math.round(connPct)}%). Database size ${s.database.size}.`,
    },
    {
      id: 'activity',
      group: 'Server',
      label: 'Activity in the last 24 hours',
      status: 'info',
      detail: `${s.activity.sign_ins_24h} sign-ins, ${s.activity.posts_24h} photo posts, ${s.activity.notifications_24h} notifications created.`,
    },
  ];
}

export default function PlatformHealth() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<PlatformHealthSnapshot | null>(null);
  const [outside, setOutside] = useState<OutsideChecks | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [outsideError, setOutsideError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((v) => {
      if (!cancelled) setAllowed(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setSnapshotError('');
    setOutsideError('');
    const [snap, out] = await Promise.allSettled([fetchPlatformHealthSnapshot(), fetchOutsideChecks()]);
    if (snap.status === 'fulfilled') setSnapshot(snap.value);
    else setSnapshotError(snap.reason instanceof Error ? snap.reason.message : 'Could not load server checks.');
    if (out.status === 'fulfilled') setOutside(out.value);
    else setOutsideError(out.reason instanceof Error ? out.reason.message : 'Could not load service checks.');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const checks = useMemo<ReadinessCheck[]>(() => {
    const list: ReadinessCheck[] = [];
    if (outside) {
      for (const c of outside.checks) {
        list.push({ id: c.id, group: 'Websites and services', label: c.label, status: c.status, detail: c.detail });
      }
    }
    if (snapshot) {
      list.push(...snapshot.jobs.map(jobCheck));
      list.push(...serverChecks(snapshot));
    }
    return list;
  }, [outside, snapshot]);

  const eventsNeedingAttention = snapshot?.events.filter((e) => e.overall !== 'ok').length ?? 0;

  const overall = useMemo(() => {
    const statuses = checks.map((c) => c.status);
    if (snapshotError || outsideError) statuses.push('fail');
    return worstStatus(statuses);
  }, [checks, snapshotError, outsideError]);

  if (allowed === false) return <Navigate to="/" replace />;

  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const bannerTitle =
    overall === 'ok' ? 'App is ready — everything is working' : overall === 'warn' ? 'Needs attention' : 'Problems found';
  const bannerText =
    overall === 'ok'
      ? 'Websites, push notifications, photo storage, the database, and all background jobs are working.'
      : [
          failCount > 0 ? `${failCount} problem${failCount === 1 ? '' : 's'}` : '',
          warnCount > 0 ? `${warnCount} item${warnCount === 1 ? '' : 's'} to check` : '',
          snapshotError || outsideError ? 'some checks could not run' : '',
        ]
          .filter(Boolean)
          .join(', ') + '. Details are below.';

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>App health</h1>
          <p className={styles.meta}>
            Is the app ready and working? Checks websites, push notifications, photos, the database, background jobs,
            app errors, and every live or upcoming event. Nothing is changed or sent.
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void load()} disabled={loading || !allowed}>
          {loading ? 'Checking…' : 'Run check again'}
        </button>
      </div>

      {loading && checks.length === 0 ? <p className={styles.loading}>Running checks…</p> : null}

      {!loading || checks.length > 0 ? (
        <>
          <OverallBanner overall={overall} title={bannerTitle} text={bannerText} />
          <p className={styles.checkedAt}>
            Last checked {new Date(snapshot?.generated_at ?? outside?.generated_at ?? Date.now()).toLocaleTimeString()}
          </p>
        </>
      ) : null}

      {snapshotError ? <p className={styles.error}>Server checks: {snapshotError}</p> : null}
      {outsideError ? <p className={styles.error}>Website and service checks: {outsideError}</p> : null}

      {snapshot ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Live and upcoming events
            {eventsNeedingAttention > 0 ? (
              <span className={styles.sectionNote}>
                {eventsNeedingAttention} need{eventsNeedingAttention === 1 ? 's' : ''} attention
              </span>
            ) : null}
          </h2>
          {snapshot.events.length === 0 ? (
            <p className={styles.muted}>No active events in the next 45 days.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>When</th>
                  <th>Readiness</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {snapshot.events.map((e) => (
                  <tr key={e.id}>
                    <td className={styles.eventName}>{e.name}</td>
                    <td>
                      {e.start_date} – {e.end_date}
                      <span className={styles.muted}> · {e.phase_label}</span>
                    </td>
                    <td>
                      <StatusPill status={e.overall} />
                      <span className={styles.counts}>
                        {e.counts.fail > 0 ? ` ${e.counts.fail} to fix` : ''}
                        {e.counts.warn > 0 ? ` ${e.counts.warn} to check` : ''}
                      </span>
                    </td>
                    <td>
                      <Link to={`/events/${e.id}/readiness`}>Open readiness check</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {checks.length > 0 ? <ReadinessChecks checks={checks} /> : null}

      {outside && outside.sentry_issues.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>App errors in the last 24 hours</h2>
          <ul className={styles.issueList}>
            {outside.sentry_issues.map((i) => (
              <li key={i.short_id || i.title} className={styles.issue}>
                <div className={styles.issueTitle}>
                  {i.is_new ? <span className={styles.newTag}>New</span> : null}
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer">
                      {i.title}
                    </a>
                  ) : (
                    i.title
                  )}
                </div>
                <div className={styles.muted}>
                  {i.count} time{i.count === 1 ? '' : 's'} · {i.users} {i.users === 1 ? 'person' : 'people'} · last seen{' '}
                  {i.last_seen ? new Date(i.last_seen).toLocaleString() : '—'}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
