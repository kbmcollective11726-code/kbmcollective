import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReadinessChecks, { OverallBanner } from '../components/ReadinessChecks';
import { fetchEventReadiness, type EventReadiness as EventReadinessData } from '../lib/readiness';
import styles from './EventReadiness.module.css';

function summaryText(data: EventReadinessData): string {
  const { warn, fail } = data.counts;
  if (fail === 0 && warn === 0) return 'Everything we check looks good for this event.';
  const parts: string[] = [];
  if (fail > 0) parts.push(`${fail} item${fail === 1 ? '' : 's'} to fix`);
  if (warn > 0) parts.push(`${warn} item${warn === 1 ? '' : 's'} to check`);
  return `${parts.join(' and ')}. Details are below.`;
}

export default function EventReadiness() {
  const { eventId } = useParams<{ eventId: string }>();
  const [data, setData] = useState<EventReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError('');
    try {
      setData(await fetchEventReadiness(eventId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the readiness check.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <Link to={`/events/${eventId}`} className={styles.back}>
        ← Event
      </Link>
      <div className={styles.head}>
        <div>
          <h1>Readiness check</h1>
          {data ? (
            <p className={styles.meta}>
              {data.event.name} · {data.event.phase_label} · Venue time {data.event.now_local}
            </p>
          ) : null}
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void load()} disabled={loading}>
          {loading ? 'Checking…' : 'Run check again'}
        </button>
      </div>

      <p className={styles.hint}>
        Checks event settings, attendees, agenda, 1:1 meetings, and notifications. Nothing is changed or sent when you
        run it.
      </p>

      {error ? (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button type="button" className={styles.refreshBtn} onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {loading && !data ? <p className={styles.loading}>Running checks…</p> : null}

      {data ? (
        <>
          <OverallBanner overall={data.overall} text={summaryText(data)} />
          <p className={styles.checkedAt}>Last checked {new Date(data.generated_at).toLocaleTimeString()}</p>
          <ReadinessChecks checks={data.checks} />
        </>
      ) : null}
    </div>
  );
}
