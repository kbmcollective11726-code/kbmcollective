import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  type PeakMoment,
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

/** Supabase compute sizes by their max_connections setting. */
const SERVER_SIZES: Record<number, string> = {
  60: 'Micro (1 GB memory)',
  90: 'Small (2 GB memory)',
  120: 'Medium (4 GB memory)',
  160: 'Large (8 GB memory)',
  240: 'XL (16 GB memory)',
  380: '2XL (32 GB memory)',
  480: '4XL (64 GB memory)',
};

const SIZE_ORDER = [60, 90, 120, 160, 240, 380, 480];

/**
 * Guideline from Nashville (159 attendees, ~88 alerts at the peak) using a small share of Medium:
 * size for the most attendees live on one day and the most alerts sent in one minute.
 */
function recommendedMaxConnections(attendees: number, pushes: number): number {
  if (attendees <= 300 && pushes < 1000) return 90;
  if (attendees <= 1500 && pushes < HEAVY_PUSHES) return 120;
  if (attendees <= 4000 && pushes < 15000) return 160;
  return 240;
}

function sizeRecommendation(s: PlatformHealthSnapshot): { status: CheckStatus; text: string } {
  const current = s.database.max_connections;
  const attendees = Number(s.load?.peak_attendees?.members ?? 0);
  const peak = busiestMoment(s);
  const pushes = Number(peak?.pushes ?? 0);
  const currentName = (SERVER_SIZES[current] ?? `${current} connections`).replace(/ \(.*\)$/, '');
  if (attendees === 0 && pushes === 0) {
    return {
      status: 'ok',
      text: `No events in the next 7 days. ${currentName} is fine; only change size between events.`,
    };
  }
  const rec = recommendedMaxConnections(attendees, pushes);
  const recName = SERVER_SIZES[rec] ?? `${rec} connections`;
  const basis = `${attendees} attendee${attendees === 1 ? '' : 's'} live on ${s.load?.peak_attendees?.date ?? 'the busiest day'}${
    pushes > 0 ? ` and about ${pushes} alerts at the busiest minute` : ''
  }`;
  const currentRank = SIZE_ORDER.indexOf(current);
  const recRank = SIZE_ORDER.indexOf(rec);
  if (currentRank >= 0 && recRank > currentRank) {
    return {
      status: 'warn',
      text: `Recommended: ${recName}, based on ${basis}. Upgrade before the event starts, not during it.`,
    };
  }
  if (currentRank > recRank) {
    return {
      status: 'ok',
      text: `${currentName} has room to spare for ${basis}. ${recName.replace(/ \(.*\)$/, '')} would also be enough; only downsize between events.`,
    };
  }
  return { status: 'ok', text: `${currentName} is the right size for ${basis}. No change needed.` };
}

/** Alerts sent in the same minute; above this a temporary upgrade before the event is worth considering. */
const HEAVY_PUSHES = 5000;

function serverSizeLabel(maxConnections: number): string {
  const size = SERVER_SIZES[maxConnections];
  return size ? `${size}, up to ${maxConnections} connections` : `Up to ${maxConnections} connections`;
}

function busiestMoment(s: PlatformHealthSnapshot): PeakMoment | null {
  const candidates = [s.load?.peak_meetings, s.load?.peak_sessions].filter((p): p is PeakMoment => !!p);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Number(b.pushes) > Number(a.pushes) ? b : a));
}

function peakSentence(p: PeakMoment): string {
  const what =
    p.meetings != null
      ? `${p.meetings} meeting${p.meetings === 1 ? '' : 's'} start together`
      : `${p.sessions} session${p.sessions === 1 ? '' : 's'} start together`;
  const zone = p.timezone ? `${p.timezone.replace(/_/g, ' ')} time` : 'venue time';
  const across = p.event.includes(' + ') ? ' across these events' : '';
  return `${p.when} (${zone}), ${p.event}: ${what}${across}, about ${Number(p.pushes)} alerts at once.`;
}

function loadVerdict(pushes: number): string {
  if (pushes < 1000) return 'Very light for this server.';
  if (pushes < HEAVY_PUSHES) return 'Comfortable for this server.';
  return 'Heavy. Consider a temporary server upgrade before the event.';
}

function serverChecks(s: PlatformHealthSnapshot): ReadinessCheck[] {
  const connPct = s.database.max_connections > 0 ? (s.database.connections / s.database.max_connections) * 100 : 0;
  const peak = busiestMoment(s);
  const rec = sizeRecommendation(s);
  return [
    {
      id: 'server-size',
      group: 'Server',
      label: 'Server size',
      status: 'info',
      detail: `${serverSizeLabel(s.database.max_connections)}. Change it only between events, never during one.`,
    },
    {
      id: 'server-size-recommendation',
      group: 'Server',
      label: 'Recommended server size for the next 7 days',
      status: rec.status,
      detail: rec.text,
    },
    {
      id: 'peak-load',
      group: 'Server',
      label: 'Busiest moment in the next 7 days',
      status: peak && Number(peak.pushes) >= HEAVY_PUSHES ? 'warn' : 'ok',
      detail: peak ? `${peakSentence(peak)} ${loadVerdict(Number(peak.pushes))}` : 'No meetings or sessions in the next 7 days.',
    },
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
      detail: `${s.database.connections} of ${s.database.max_connections} connections open (${Math.round(connPct)}%)${
        s.database.active_connections != null ? `, ${s.database.active_connections} doing work right now` : ''
      }. Database size ${s.database.size}.`,
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

  const whatToKnow = useMemo<string[]>(() => {
    const notes: string[] = [];
    const problems = checks.filter((c) => c.status === 'fail' && c.group !== 'Server');
    if (problems.length > 0) {
      notes.push(`Fix first: ${problems.map((c) => c.label).join(', ')}.`);
    }
    if (snapshot) {
      if (snapshot.events.length === 0) {
        notes.push('No live or upcoming events in the next 45 days.');
      }
      for (const e of snapshot.events) {
        const parts: string[] = [];
        if (e.counts.fail > 0) parts.push(`${e.counts.fail} to fix`);
        if (e.counts.warn > 0) parts.push(`${e.counts.warn} to check`);
        notes.push(`${e.name} (${e.phase_label}): ${parts.length > 0 ? parts.join(', ') : 'ready'}.`);
      }
      const peak = busiestMoment(snapshot);
      notes.push(
        peak
          ? `Busiest moment this week: ${peakSentence(peak)} ${loadVerdict(Number(peak.pushes))}`
          : 'No meetings or sessions in the next 7 days, so reminder load is zero.',
      );
      notes.push(
        `Server: ${serverSizeLabel(snapshot.database.max_connections)}; ${snapshot.database.connections} connections open${
          snapshot.database.active_connections != null ? `, ${snapshot.database.active_connections} working` : ''
        }.`,
      );
      notes.push(`Server size: ${sizeRecommendation(snapshot).text}`);
    }
    if (outside?.checks.some((c) => c.id === 'sentry' && c.status === 'not_set_up')) {
      notes.push('App error tracking (Sentry) is not connected to this page yet.');
    }
    return notes;
  }, [checks, snapshot, outside]);

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

      {whatToKnow.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What to know</h2>
          <ul className={styles.knowList}>
            {whatToKnow.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

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
                  <Fragment key={e.id}>
                    <tr className={e.issues && e.issues.length > 0 ? styles.rowWithIssues : undefined}>
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
                    {e.issues && e.issues.length > 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.issuesCell}>
                          <ul className={styles.eventIssues}>
                            {e.issues.map((issue) => (
                              <li key={issue.label}>
                                <StatusPill status={issue.status} />
                                <span>
                                  <strong>{issue.label}:</strong> {issue.detail}
                                  {issue.items && issue.items.length > 0 ? (
                                    <span className={styles.muted}>
                                      {' '}
                                      {issue.items.slice(0, 3).join('; ')}
                                      {issue.items.length > 3 ? '…' : ''}
                                    </span>
                                  ) : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
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
