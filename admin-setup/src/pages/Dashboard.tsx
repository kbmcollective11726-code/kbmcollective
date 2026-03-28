import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import type { SessionRatingRow, B2BFeedbackRow } from '../lib/types';
import styles from './Dashboard.module.css';

type VendorPerf = {
  booth_id: string;
  vendor_name: string;
  feedback_count: number;
  avg_rating: number | null;
  pct_meet_again?: number | null;
  pct_recommend?: number | null;
  avg_work_with_likelihood?: number | null;
};

function bySession(sessionRows: SessionRatingRow[]) {
  const byTitle = new Map<string, { count: number; sum: number }>();
  for (const r of sessionRows) {
    const key = r.session_title ?? r.session_id ?? '—';
    const cur = byTitle.get(key) ?? { count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += r.rating;
    byTitle.set(key, cur);
  }
  return Array.from(byTitle.entries()).map(([title, { count, sum }]) => ({
    session_title: title,
    count,
    avg: count > 0 ? sum / count : 0,
  }));
}

function ratingDistribution(rows: SessionRatingRow[]) {
  const dist: number[] = [0, 0, 0, 0, 0]; // 1..5
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) {
      const idx = r.rating - 1;
      dist[idx] = (dist[idx] ?? 0) + 1;
    }
  }
  return dist;
}

function Stars({ value, max = 5 }: { value: number; max?: number }) {
  const full = Math.floor(value);
  const hasHalf = value - full >= 0.5;
  const empty = max - full - (hasHalf ? 1 : 0);
  return (
    <span className={styles.stars} aria-label={`${value} out of ${max} stars`}>
      {'★'.repeat(full)}
      {hasHalf && '½'}
      {'☆'.repeat(empty)}
    </span>
  );
}

export default function Dashboard() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [sessionList, setSessionList] = useState<SessionRatingRow[]>([]);
  const [b2bList, setB2bList] = useState<B2BFeedbackRow[]>([]);
  const [vendorPerf, setVendorPerf] = useState<VendorPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  type TabType = 'sessions' | 'b2b';
  const [activeTab, setActiveTab] = useState<TabType>('sessions');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setError(null);
    (async () => {
      const errors: string[] = [];
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);

        const sessionRes = await supabase.rpc('get_event_session_feedback', { p_event_id: eventId });
        if (sessionRes.error) errors.push(`Session feedback: ${sessionRes.error.message}`);
        else if (!cancelled) setSessionList((sessionRes.data as SessionRatingRow[]) ?? []);

        const b2bRes = await supabase.rpc('get_event_b2b_feedback', { p_event_id: eventId });
        if (b2bRes.error) errors.push(`B2B feedback: ${b2bRes.error.message}`);
        else if (!cancelled) setB2bList((b2bRes.data as B2BFeedbackRow[]) ?? []);

        const perfRes = await supabase.rpc('get_b2b_vendor_performance', { p_event_id: eventId, p_booth_id: null });
        if (perfRes.error) errors.push(`Vendor performance: ${perfRes.error.message}`);
        else if (!cancelled) {
          const data = perfRes.data;
          const arr = Array.isArray(data) ? data : (data != null && typeof data === 'object' ? [data] : []);
          setVendorPerf(arr as VendorPerf[]);
        }

        if (!cancelled && errors.length > 0) setError(errors.join('. '));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
          setSessionList([]);
          setB2bList([]);
          setVendorPerf([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const sessionStats = bySession(sessionList);
  const sessionAvg = sessionList.length > 0
    ? sessionList.reduce((s, r) => s + r.rating, 0) / sessionList.length
    : null;
  const b2bAvg = b2bList.length > 0
    ? b2bList.reduce((s, r) => s + r.rating, 0) / b2bList.length
    : null;
  const ratingDist = ratingDistribution(sessionList);

  const topSessions = [...sessionStats].filter(s => s.count >= 1).sort((a, b) => b.avg - a.avg).slice(0, 6);
  const lowestSessions = [...sessionStats].filter(s => s.count >= 1).sort((a, b) => a.avg - b.avg).slice(0, 4);
  const sessionsNeedingAttention = lowestSessions.filter(s => s.avg < 3);

  const vendorsWithFeedback = vendorPerf.filter(v => v.feedback_count >= 1);
  const topVendorsByRating = [...vendorsWithFeedback].sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0)).slice(0, 6);
  const vendorsWantToMeetAgain = [...vendorsWithFeedback]
    .filter(v => v.pct_meet_again != null)
    .sort((a, b) => (b.pct_meet_again ?? 0) - (a.pct_meet_again ?? 0))
    .slice(0, 5);
  const vendorsWouldRecommend = [...vendorsWithFeedback]
    .filter(v => v.pct_recommend != null)
    .sort((a, b) => (b.pct_recommend ?? 0) - (a.pct_recommend ?? 0))
    .slice(0, 5);

  const sessionCommentsWithContext = sessionList
    .filter(r => r.comment && r.comment.trim().length > 0)
    .sort((a, b) => new Date((b.created_at ?? '')).getTime() - new Date((a.created_at ?? '')).getTime())
    .slice(0, 6)
    .map(r => ({ type: 'session' as const, session_title: r.session_title ?? 'Session', rating: r.rating, comment: (r.comment ?? '').trim(), user_name: r.user_name ?? r.user_email ?? 'Attendee' }));
  const b2bCommentsWithContext = b2bList
    .filter(r => r.comment && r.comment.trim().length > 0)
    .sort((a, b) => new Date((b.created_at ?? '')).getTime() - new Date((a.created_at ?? '')).getTime())
    .slice(0, 4)
    .map(r => ({ type: 'b2b' as const, vendor_name: r.vendor_name ?? 'Vendor', rating: r.rating, comment: (r.comment ?? '').trim(), user_name: r.attendee_name ?? r.attendee_email ?? 'Attendee' }));

  const recentSession = [...sessionList].sort((a, b) => new Date((b.created_at ?? '')).getTime() - new Date((a.created_at ?? '')).getTime()).slice(0, 6);
  const recentB2b = [...b2bList].sort((a, b) => new Date((b.created_at ?? '')).getTime() - new Date((a.created_at ?? '')).getTime()).slice(0, 6);
  const sessionQuotes = sessionCommentsWithContext;
  const b2bQuotes = b2bCommentsWithContext;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1 className={styles.title}>Dashboard — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        See what attendees think about sessions and speakers, and which vendors they want to see again.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      {/* Quick insights */}
      {(sessionList.length > 0 || b2bList.length > 0) && (
        <div className={styles.insightsBar}>
          {sessionList.length > 0 && (
            <span className={styles.insight}>
              <strong>{sessionList.length}</strong> session rating{sessionList.length !== 1 ? 's' : ''}
              {sessionAvg != null && ` · overall avg ${sessionAvg.toFixed(1)}/5`}
            </span>
          )}
          {sessionsNeedingAttention.length > 0 && (
            <span className={styles.insightWarning}>
              <strong>{sessionsNeedingAttention.length}</strong> session{sessionsNeedingAttention.length !== 1 ? 's' : ''} below 3.0 — consider follow-up
            </span>
          )}
          {b2bList.length > 0 && (
            <span className={styles.insight}>
              <strong>{b2bList.length}</strong> B2B feedback
              {b2bAvg != null && ` · avg ${b2bAvg.toFixed(1)}/5`}
            </span>
          )}
          {vendorsWithFeedback.some(v => (v.pct_meet_again ?? 0) >= 90) && (
            <span className={styles.insightPositive}>
              <strong>{vendorsWithFeedback.filter(v => (v.pct_meet_again ?? 0) >= 90).length}</strong> vendor{vendorsWithFeedback.filter(v => (v.pct_meet_again ?? 0) >= 90).length !== 1 ? 's' : ''} with 90%+ “would meet again”
            </span>
          )}
        </div>
      )}

      {/* Summary cards */}
      <section className={styles.cards}>
        <Link to={`/events/${eventId}/session-feedback`} className={styles.bigCard}>
          <span className={styles.bigCardLabel}>Session feedback</span>
          <span className={styles.bigCardValue}>{sessionList.length}</span>
          <span className={styles.bigCardSub}>
            {sessionAvg != null ? `Avg ${sessionAvg.toFixed(1)}/5 · ${sessionStats.length} sessions rated` : 'No ratings yet'}
          </span>
          <span className={styles.cardLink}>View all →</span>
        </Link>
        <Link to={`/events/${eventId}/b2b-feedback`} className={styles.bigCard}>
          <span className={styles.bigCardLabel}>B2B meeting feedback</span>
          <span className={styles.bigCardValue}>{b2bList.length}</span>
          <span className={styles.bigCardSub}>
            {b2bAvg != null ? `Avg ${b2bAvg.toFixed(1)}/5 · ${vendorsWithFeedback.length} vendors` : 'No ratings yet'}
          </span>
          <span className={styles.cardLink}>View all →</span>
        </Link>
      </section>

      {/* Tabs: Sessions | B2B */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={activeTab === 'sessions' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setActiveTab('sessions')}
        >
          Sessions & speakers
        </button>
        <button
          type="button"
          className={activeTab === 'b2b' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setActiveTab('b2b')}
        >
          B2B / Vendors
        </button>
      </div>

      {activeTab === 'sessions' && (
        <>
          {sessionQuotes.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>What attendees are saying</h2>
              <p className={styles.sectionDesc}>Recent comments from session feedback.</p>
              <div className={styles.quoteGrid}>
                {sessionQuotes.map((q, i) => (
                  <div key={i} className={styles.quoteCard}>
                    <p className={styles.quoteText}>"{q.comment}"</p>
                    <div className={styles.quoteMeta}>
                      <span className={styles.quoteSource}>{q.session_title}</span>
                      <Stars value={q.rating} />
                      <span className={styles.quoteBy}>{q.user_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Sessions & speakers</h2>
            <p className={styles.sectionDesc}>Which sessions attendees rate highest and which may need attention.</p>
            {sessionList.length > 0 && (
              <div className={styles.distBar}>
                <span className={styles.distLabel}>Rating spread</span>
                <div className={styles.distRow}>
                  {[5, 4, 3, 2, 1].map((star) => (
                    <div key={star} className={styles.distSegment}>
                      <span className={styles.distStar}>{star}★</span>
                      <span className={styles.distCount}>{ratingDist[star - 1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {topSessions.length === 0 ? (
              <p className={styles.empty}>No session ratings yet.</p>
            ) : (
              <>
                <h3 className={styles.subTitle}>Top rated — sessions people want to see</h3>
                <ul className={styles.list}>
                  {topSessions.map((s, i) => (
                    <li key={i} className={styles.listItem}>
                      <span className={styles.listItemName}>{s.session_title}</span>
                      <div className={styles.listItemMetaRow}>
                        <Stars value={s.avg} />
                        <span>{s.count} rating{s.count !== 1 ? 's' : ''} · avg {s.avg.toFixed(1)}/5</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {lowestSessions.length > 0 && (
                  <>
                    <h3 className={styles.subTitleDanger}>Needs attention</h3>
                    <ul className={styles.list}>
                      {lowestSessions.map((s, i) => (
                        <li key={`low-${i}`} className={styles.listItemDanger}>
                          <span className={styles.listItemName}>{s.session_title}</span>
                          <div className={styles.listItemMetaRow}>
                            <Stars value={s.avg} />
                            <span>{s.count} rating{s.count !== 1 ? 's' : ''} · avg {s.avg.toFixed(1)}/5</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <Link to={`/events/${eventId}/session-feedback`} className={styles.sectionLink}>View all session feedback →</Link>
              </>
            )}
          </section>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent session feedback</h2>
            {recentSession.length === 0 ? (
              <p className={styles.empty}>No session feedback yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>User</th>
                      <th>Rating</th>
                      <th>Comment</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSession.map((row) => (
                      <tr key={row.id}>
                        <td>{row.session_title ?? '—'}</td>
                        <td>{row.user_name ?? row.user_email ?? '—'}</td>
                        <td><Stars value={row.rating} /></td>
                        <td>{row.comment ? (row.comment.length > 50 ? row.comment.slice(0, 50) + '…' : row.comment) : '—'}</td>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sessionList.length > 0 && (
              <Link to={`/events/${eventId}/session-feedback`} className={styles.sectionLink}>View all session feedback →</Link>
            )}
          </section>
        </>
      )}

      {activeTab === 'b2b' && (
        <>
          {b2bQuotes.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>What attendees are saying</h2>
              <p className={styles.sectionDesc}>Recent comments from B2B / vendor feedback.</p>
              <div className={styles.quoteGrid}>
                {b2bQuotes.map((q, i) => (
                  <div key={i} className={styles.quoteCard}>
                    <p className={styles.quoteText}>"{q.comment}"</p>
                    <div className={styles.quoteMeta}>
                      <span className={styles.quoteSource}>{q.vendor_name}</span>
                      <Stars value={q.rating} />
                      <span className={styles.quoteBy}>{q.user_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Vendors</h2>
            <p className={styles.sectionDesc}>Which vendors attendees want to meet again and would recommend.</p>
            {topVendorsByRating.length === 0 ? (
              <p className={styles.empty}>No B2B feedback yet.</p>
            ) : (
              <>
                <h3 className={styles.subTitle}>Top rated</h3>
                <ul className={styles.list}>
                  {topVendorsByRating.map((v) => (
                    <li key={v.booth_id} className={styles.listItem}>
                      <span className={styles.listItemName}>{v.vendor_name}</span>
                      <div className={styles.listItemMetaRow}>
                        <Stars value={v.avg_rating ?? 0} />
                        <span>{v.feedback_count} feedback</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {vendorsWantToMeetAgain.length > 0 && (
                  <>
                    <h3 className={styles.subTitle}>Would meet again</h3>
                    <ul className={styles.list}>
                      {vendorsWantToMeetAgain.map((v) => (
                        <li key={`meet-${v.booth_id}`} className={styles.listItem}>
                          <span className={styles.listItemName}>{v.vendor_name}</span>
                          <div className={styles.progressWrap}>
                            <div className={styles.progressBar} style={{ width: `${v.pct_meet_again ?? 0}%` }} />
                            <span className={styles.progressLabel}>{v.pct_meet_again != null ? v.pct_meet_again.toFixed(0) : 0}%</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {vendorsWouldRecommend.length > 0 && (
                  <>
                    <h3 className={styles.subTitle}>Would recommend</h3>
                    <ul className={styles.list}>
                      {vendorsWouldRecommend.map((v) => (
                        <li key={`rec-${v.booth_id}`} className={styles.listItem}>
                          <span className={styles.listItemName}>{v.vendor_name}</span>
                          <div className={styles.progressWrap}>
                            <div className={styles.progressBar} style={{ width: `${v.pct_recommend ?? 0}%` }} />
                            <span className={styles.progressLabel}>{v.pct_recommend != null ? v.pct_recommend.toFixed(0) : 0}%</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <Link to={`/events/${eventId}/b2b-feedback`} className={styles.sectionLink}>All B2B feedback →</Link>
              </>
            )}
          </section>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent B2B feedback</h2>
            {recentB2b.length === 0 ? (
              <p className={styles.empty}>No B2B meeting feedback yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Attendee</th>
                      <th>Rating</th>
                      <th>Meet again</th>
                      <th>Recommend</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentB2b.map((row) => (
                      <tr key={row.id}>
                        <td>{row.vendor_name ?? '—'}</td>
                        <td>{row.attendee_name ?? row.attendee_email ?? '—'}</td>
                        <td><Stars value={row.rating} /></td>
                        <td>{row.meet_again ? 'Yes' : 'No'}</td>
                        <td>{row.recommend_vendor ? 'Yes' : 'No'}</td>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {b2bList.length > 0 && (
              <Link to={`/events/${eventId}/b2b-feedback`} className={styles.sectionLink}>View all B2B feedback →</Link>
            )}
          </section>
        </>
      )}
    </div>
  );
}
