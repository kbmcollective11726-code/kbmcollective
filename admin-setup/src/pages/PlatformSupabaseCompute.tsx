import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import styles from './PlatformSupabaseCompute.module.css';

/** People actively in the app at a busy peak (not total registered accounts). */
const PEOPLE_COMFORT = [
  { tier: 'Nano', people: 100 },
  { tier: 'Micro', people: 250 },
  { tier: 'Small', people: 800 },
  { tier: 'Medium', people: 2500 },
  { tier: 'Large+', people: 6000 },
] as const;

const MAX_PEOPLE = Math.max(...PEOPLE_COMFORT.map((r) => r.people));

const ACTIVITY_ROWS = [
  {
    activity: '“Meeting soon” / session reminders',
    about: 'About 200 phone alerts',
    note: 'Sent in small batches — the system handles this fine on Micro.',
    ok: true,
  },
  {
    activity: '“Meeting starting” alerts (same busy period)',
    about: 'About 200 more → ~400 total',
    note: 'Often roughly twice as many alerts as people, because two reminder types can overlap.',
    ok: true,
  },
  {
    activity: 'People opening Agenda',
    about: 'Up to ~200 people',
    note: 'Normal app browsing — fine on Micro.',
    ok: true,
  },
  {
    activity: 'People using 1:1 meetings',
    about: 'Many people at once',
    note: 'Looking up booths and meeting times — fine on Micro.',
    ok: true,
  },
  {
    activity: 'Taking and posting photos',
    about: 'Some of the 200 (not everyone at once)',
    note: 'Heavier on the system — watch if the app feels slow during peak photo moments.',
    ok: false,
  },
  {
    activity: 'Likes, comments, chat',
    about: 'Ongoing',
    note: 'Normal social use — fine on Micro for a 200-person event.',
    ok: true,
  },
] as const;

const UPGRADE_ROWS = [
  {
    people: 'Up to 200',
    alerts: 'About 400+ alerts',
    compute: 'Micro',
    action: 'You’re fine — typical busy event',
    tone: 'ok' as const,
  },
  {
    people: '200 – 250',
    alerts: 'About 400 – 500 alerts',
    compute: 'Micro',
    action: 'Still fine — check the dashboard if things feel slow',
    tone: 'ok' as const,
  },
  {
    people: '250 – 800',
    alerts: 'About 500 – 1,600 alerts',
    compute: 'Small (~$15/mo)',
    action: 'Upgrade before an event this busy',
    tone: 'warn' as const,
  },
  {
    people: '800 – 2,500',
    alerts: 'About 1,600 – 5,000 alerts',
    compute: 'Medium (~$60/mo)',
    action: 'Upgrade ahead of that peak day',
    tone: 'warn' as const,
  },
  {
    people: '2,500 or more',
    alerts: 'Very large alert waves',
    compute: 'Large or bigger',
    action: 'Need a stronger plan',
    tone: 'neutral' as const,
  },
] as const;

/** Platform-admin guide: when to raise Supabase compute (plain language). */
export default function PlatformSupabaseCompute() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((ok) => {
      if (!cancelled) setAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <div className={styles.page}>
        <p className={styles.hint}>Checking access…</p>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>
        ← All events
      </Link>
      <h1>When to upgrade Supabase (compute)</h1>
      <p className={styles.hint}>
        This page helps you decide if the database plan is big enough for a busy
        event day. Use <strong>people using the app at the same busy moment</strong>
        — not how many accounts are registered overall.
      </p>

      <div className={styles.callout}>
        <strong>Two different numbers (easy mix-up)</strong>
        <div>
          <strong>People in the app</strong> = how many attendees are actively using
          KBM Connect in the same few minutes (agenda, 1:1, photos, feed).
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Phone notifications</strong> = how many alerts go out around that
          same time. That number is often about <strong>twice</strong> the people
          (for example: “meeting soon” <em>and</em> “meeting starting”). So 200
          people can mean about 400 notifications — that is expected, not a second
          group of users.
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>200</span>
          <span className={styles.statLabel}>People in the app (example)</span>
        </div>
        <div className={`${styles.stat} ${styles.statWarn}`}>
          <span className={styles.statValue}>~400</span>
          <span className={styles.statLabel}>Phone notifications (about 2×)</span>
        </div>
        <div className={`${styles.stat} ${styles.statOk}`}>
          <span className={styles.statValue}>Micro</span>
          <span className={styles.statLabel}>Plan size that still works</span>
        </div>
      </div>

      <section className={styles.section}>
        <h2>What a busy 200-person event looks like</h2>
        <p className={styles.hint}>
          All of this can happen in the same few minutes. That is the “hard day”
          we plan for.
        </p>
        <div className={styles.usageWrap}>
          <div className={styles.usageLabels}>
            <span>How the busy moment adds up</span>
            <span>200 people + ~400 alerts + photos/posts</span>
          </div>
          <div
            className={styles.usageBar}
            role="img"
            aria-label="Busy moment mix: people, notifications, and posts"
          >
            <div className={`${styles.usageSeg} ${styles.segBlue}`} style={{ flex: 200 }} />
            <div className={`${styles.usageSeg} ${styles.segOrange}`} style={{ flex: 400 }} />
            <div className={`${styles.usageSeg} ${styles.segPurple}`} style={{ flex: 120 }} />
          </div>
        </div>
        <div className={styles.legend}>
          <span className={styles.pill}>
            <span className={`${styles.dot} ${styles.dotBlue}`} /> People in the app
          </span>
          <span className={styles.pill}>
            <span className={`${styles.dot} ${styles.dotOrange}`} /> Phone notifications (~2× people)
          </span>
          <span className={styles.pill}>
            <span className={`${styles.dot} ${styles.dotPurple}`} /> Photos, posts, chat
          </span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>What’s happening</th>
                <th>About how much</th>
                <th>What it means</th>
                <th>OK on Micro?</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVITY_ROWS.map((row) => (
                <tr key={row.activity}>
                  <td>{row.activity}</td>
                  <td>{row.about}</td>
                  <td>{row.note}</td>
                  <td className={row.ok ? styles.toneOk : styles.toneWarn}>
                    {row.ok ? 'Yes' : 'Watch for slowness'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.card}>
        <p className={styles.cardTitle}>How many people each plan can handle</p>
        <p className={styles.cardSub}>
          Taller bar = more people using the app at once, while notifications are
          also going out (often about twice as many alerts as people).
        </p>
        <div
          className={styles.barChart}
          role="img"
          aria-label="How many people in the app each Supabase plan size can handle"
        >
          {PEOPLE_COMFORT.map((row, i) => {
            const heightPct = Math.max(8, (row.people / MAX_PEOPLE) * 100);
            return (
              <div key={row.tier} className={styles.barCol}>
                <span className={styles.barValue}>{row.people.toLocaleString()}</span>
                <div
                  className={`${styles.bar} ${i <= 1 ? '' : styles.barMuted}`}
                  style={{ height: `${heightPct}%` }}
                  title={`${row.tier}: about ${row.people} people in the app`}
                />
                <span className={styles.barLabel}>{row.tier}</span>
              </div>
            );
          })}
        </div>
        <p className={styles.chartCaption}>
          Numbers = people in the app at the busy moment (not total registered
          users). Micro is comfortable up to about 250 people with ~500
          notifications. A 200-person busy event sits under that.
        </p>
      </div>

      <section className={styles.section}>
        <h2>When to upgrade</h2>
        <p className={styles.hint}>
          Read left to right: first how many people are in the app, then how many
          phone notifications that usually means, then which plan to use.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>People in the app at once</th>
                <th>Phone notifications around then</th>
                <th>Plan size</th>
                <th>What to do</th>
              </tr>
            </thead>
            <tbody>
              {UPGRADE_ROWS.map((row) => (
                <tr key={row.people}>
                  <td>{row.people}</td>
                  <td>{row.alerts}</td>
                  <td>{row.compute}</td>
                  <td
                    className={
                      row.tone === 'ok'
                        ? styles.toneOk
                        : row.tone === 'warn'
                          ? styles.toneWarn
                          : undefined
                    }
                  >
                    {row.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.twoCol}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Why 200 people + 400 alerts is still OK</p>
          <ul className={styles.list}>
            <li>
              Notifications are sent in small groups, not all as one giant hit.
            </li>
            <li>
              Phones share the backend — 200 people does not mean 200 separate
              heavy database logins.
            </li>
            <li>
              The two alert types usually overlap over a few minutes, not only
              one second.
            </li>
            <li>
              Not everyone posts a photo at the exact same time — that keeps the
              heaviest work lighter.
            </li>
          </ul>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>When you should upgrade anyway</p>
          <ul className={styles.list}>
            <li>Two big events are busy at the same time on this same project</li>
            <li>Agenda or feed feels slow for many people during peak</li>
            <li>
              Supabase shows high CPU for a long stretch on the Infrastructure /
              reports page
            </li>
            <li>
              You expect regular events with 250+ people all active together
            </li>
          </ul>
        </div>
      </div>

      <section className={styles.section}>
        <h2>Plan sizes at a glance</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>About $/month</th>
                <th>People in app (busy moment)</th>
                <th>Phone notifications (about 2×)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Nano</td>
                <td>Free / ~$10*</td>
                <td>Up to ~100</td>
                <td>Up to ~200</td>
              </tr>
              <tr>
                <td>Micro</td>
                <td>~$10</td>
                <td>Up to ~250</td>
                <td>Up to ~500</td>
              </tr>
              <tr>
                <td>Small</td>
                <td>~$15</td>
                <td>Up to ~800</td>
                <td>Up to ~1,600</td>
              </tr>
              <tr>
                <td>Medium</td>
                <td>~$60</td>
                <td>Up to ~2,500</td>
                <td>Up to ~5,000</td>
              </tr>
              <tr>
                <td>Large+</td>
                <td>~$110+</td>
                <td>~6,000+</td>
                <td>~12,000+</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.chartCaption}>
          *On a paid Supabase org, Nano is billed like Micro — prefer Micro.
          These are planning guides for KBM Connect, not a lab load test. To
          change size: Supabase → Project Settings → Infrastructure.
        </p>
      </section>

      <div className={styles.callout}>
        <strong>Simple takeaway</strong>
        Count <strong>people using the app together</strong>. Expect{' '}
        <strong>about twice as many phone notifications</strong> in a busy
        meeting block. For about 200 people and ~400 alerts, stay on{' '}
        <strong>Micro</strong>. Move to <strong>Small</strong> when you regularly
        have about 250–300+ people that busy at once, or if the app feels slow
        on peak day.
      </div>
    </div>
  );
}
