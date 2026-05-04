import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type { Event } from '../lib/types';
import styles from './EventBadges.module.css';

type MemberRow = {
  user_id: string;
  role: string;
  full_name: string;
  email: string;
  company: string | null;
  token: string | null;
};

function qrPayload(token: string): string {
  return `collectivelive://badge?t=${encodeURIComponent(token)}`;
}

/** Use contain for logos, cover for banners. */
function eventHeroMedia(ev: Event | null): { src: string; fit: 'contain' | 'cover' } | null {
  if (!ev) return null;
  const logo = (ev.logo_url ?? '').trim();
  if (logo) return { src: logo, fit: 'contain' };
  const banner = (ev.banner_url ?? '').trim();
  if (banner) return { src: banner, fit: 'cover' };
  return null;
}

function formatEventDates(ev: Event | null): string {
  if (!ev?.start_date) return '';
  try {
    const s = new Date(ev.start_date);
    const e = ev.end_date ? new Date(ev.end_date) : null;
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    if (e && !Number.isNaN(e.getTime()) && e.getTime() !== s.getTime()) {
      return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
    }
    return s.toLocaleDateString(undefined, opts);
  } catch {
    return '';
  }
}

function chunkMembers<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Pad last chunk so 4-up always shows a 2×2 grid (empty cut cells if fewer than 4 on the sheet). */
function padChunkToSize<T>(chunk: T[], size: number): (T | null)[] {
  const out: (T | null)[] = [...chunk];
  while (out.length < size) out.push(null);
  return out;
}

function BadgeFace({
  m,
  event,
  footerLine,
  qrMap,
}: {
  m: MemberRow;
  event: Event | null;
  footerLine: string;
  qrMap: Record<string, string>;
}) {
  const hero = eventHeroMedia(event);
  return (
    <div className={styles.badgeInner}>
      {hero ? (
        <div className={styles.badgeBanner}>
          <img
            src={hero.src}
            alt=""
            className={`${styles.badgeBannerImg} ${hero.fit === 'contain' ? styles.badgeBannerImgContain : styles.badgeBannerImgCover}`}
          />
        </div>
      ) : (
        <div className={styles.badgeBannerPlaceholder}>Event image (set banner or logo on event)</div>
      )}
      <div className={styles.badgeBody}>
        <div className={styles.badgeTitle}>{event?.name ?? 'Event'}</div>
        <div className={styles.name}>{m.full_name}</div>
        <div className={styles.company}>{m.company?.trim() || '—'}</div>
        <div className={styles.qrWrap}>
          {m.token && qrMap[m.user_id] ? (
            <img src={qrMap[m.user_id]} alt="" width={176} height={176} />
          ) : (
            <div className={styles.noQr}>Generate tokens first</div>
          )}
        </div>
        <div className={styles.footer}>
          <div>{footerLine || event?.venue || '\u00a0'}</div>
        </div>
      </div>
    </div>
  );
}

function BadgeBack({
  m,
  event,
  footerLine,
}: {
  m: MemberRow;
  event: Event | null;
  footerLine: string;
}) {
  const hero = eventHeroMedia(event);
  const dates = formatEventDates(event);
  return (
    <div className={`${styles.badgeInner} ${styles.badgeInnerBack}`}>
      {hero ? (
        <div className={styles.badgeBanner}>
          <img
            src={hero.src}
            alt=""
            className={`${styles.badgeBannerImg} ${hero.fit === 'contain' ? styles.badgeBannerImgContain : styles.badgeBannerImgCover}`}
          />
        </div>
      ) : (
        <div className={styles.badgeBannerPlaceholder}>Event image (set banner or logo on event)</div>
      )}
      <div className={styles.badgeBody}>
        <div className={styles.badgeTitle}>{event?.name ?? 'Event'}</div>
        <div className={styles.backAttendeeName}>{m.full_name}</div>
        {dates ? <div className={styles.backDates}>{dates}</div> : null}
        <div className={styles.company}>{event?.venue?.trim() || '—'}</div>
        <div className={styles.backBody}>Scan the QR on the front with KBM Connect to network.</div>
        <div className={styles.footer}>
          <div>{footerLine || '\u00a0'}</div>
        </div>
      </div>
    </div>
  );
}

export default function EventBadges() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [footerLine, setFooterLine] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
  const [error, setError] = useState('');
  /** 1up = one 3.75″×5.5″ per page; 2up = two on Letter; 4up = four on Letter (2×2). */
  const [printLayout, setPrintLayout] = useState<'1up' | '2up' | '4up'>('4up');
  /** Print a second sheet per attendee with event + name (duplex or separate print pass). */
  const [includeBack, setIncludeBack] = useState(false);

  useLayoutEffect(() => {
    if (!eventId || location.hash !== '#scan-log') return;
    navigate(`/events/${eventId}/scan-log`, { replace: true });
  }, [eventId, location.hash, navigate]);

  const load = useCallback(async () => {
    if (!eventId) return;
    if (location.hash === '#scan-log') {
      setLoading(false);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, venue, logo_url, banner_url, badge_host_footer, start_date, end_date')
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      const e = ev as Event & { badge_host_footer?: string | null };
      setEvent(e as Event);
      setFooterLine(e.badge_host_footer ?? '');

      const { data: memRaw, error: memErr } = await supabase
        .from('event_members')
        .select('user_id, role, users!inner(full_name, email, company)')
        .eq('event_id', eventId);
      if (memErr) throw memErr;

      const { data: tokRows, error: tokErr } = await supabase
        .from('event_badge_tokens')
        .select('user_id, token')
        .eq('event_id', eventId);
      if (tokErr) throw tokErr;

      const byUser = new Map((tokRows ?? []).map((r: { user_id: string; token: string }) => [r.user_id, r.token]));

      const rows: MemberRow[] = (memRaw ?? []).map((r: Record<string, unknown>) => {
        const u = r.users as { full_name?: string; email?: string; company?: string | null };
        const uid = r.user_id as string;
        return {
          user_id: uid,
          role: String(r.role ?? 'attendee'),
          full_name: u?.full_name ?? '—',
          email: u?.email ?? '',
          company: u?.company ?? null,
          token: byUser.get(uid) ?? null,
        };
      });
      rows.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' }));
      setMembers(rows);

      const nextQr: Record<string, string> = {};
      for (const m of rows) {
        if (m.token) {
          nextQr[m.user_id] = await QRCode.toDataURL(qrPayload(m.token), {
            width: 220,
            margin: 1,
            color: { dark: '#111111', light: '#ffffffff' },
          });
        }
      }
      setQrMap(nextQr);
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [eventId, location.hash]);

  useEffect(() => {
    load();
  }, [load]);

  const ensureTokens = async () => {
    if (!eventId) return;
    setGenerating(true);
    setError('');
    try {
      const { data, error: err } = await supabase.rpc('ensure_event_badge_tokens', { p_event_id: eventId });
      if (err) throw err;
      void data;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveFooter = async () => {
    if (!eventId) return;
    setSavingFooter(true);
    setError('');
    try {
      const { error: err } = await supabase
        .from('events')
        .update({ badge_host_footer: footerLine.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', eventId);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setSavingFooter(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1 className={styles.pageTitle}>Badges — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        3.75″×5.5″ printable badges (sleeve-friendly) for every member. QR opens in KBM Connect — use <strong>Scan log</strong>{' '}
        on the event hub for app capture history (who scanned whom, notes, meetings).
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Footer line</h2>
        <p className={styles.sectionHint}>Printed at the bottom (e.g. &quot;Hosted by Opal Group&quot;).</p>
        <div className={styles.footerRow}>
          <input
            type="text"
            className={styles.input}
            value={footerLine}
            onChange={(e) => setFooterLine(e.target.value)}
            placeholder='e.g. Hosted by Opal Group — The HR Executive Summits Series'
          />
          <button type="button" className={styles.btnPrimary} onClick={saveFooter} disabled={savingFooter}>
            {savingFooter ? 'Saving…' : 'Save footer'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Badge tokens</h2>
        <p className={styles.sectionHint}>
          Generate opaque QR tokens for all current event members (idempotent — existing tokens are kept).
        </p>
        <button type="button" className={styles.btnPrimary} onClick={ensureTokens} disabled={generating}>
          {generating ? 'Generating…' : 'Generate / refresh tokens'}
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Print badges</h2>
        <p className={styles.sectionHint}>
          Use <strong>Print</strong> → <strong>Letter</strong> for multi-up. <strong>2 per page</strong> is one row of two large badges; <strong>4 per page</strong> is
          a 2×2 grid of four smaller badges (same info, tighter type and QR). For 1-up, use paper <strong>3.75″×5.5″</strong> or trim. Turn off{' '}
          <strong>Headers and footers</strong> in the print dialog. The event image uses <strong>Logo</strong> if set, otherwise <strong>Banner</strong>.
        </p>
        <div className={styles.layoutRow}>
          <span className={styles.layoutLabel}>Layout:</span>
          <label className={styles.layoutOpt}>
            <input type="radio" name="printLayout" checked={printLayout === '1up'} onChange={() => setPrintLayout('1up')} />
            1 per page (3.75″×5.5″)
          </label>
          <label className={styles.layoutOpt}>
            <input type="radio" name="printLayout" checked={printLayout === '2up'} onChange={() => setPrintLayout('2up')} />
            2 per page (Letter — two large badges in one row)
          </label>
          <label className={styles.layoutOpt}>
            <input type="radio" name="printLayout" checked={printLayout === '4up'} onChange={() => setPrintLayout('4up')} />
            4 per page (Letter — four smaller badges in a 2×2 grid)
          </label>
        </div>
        <div className={styles.duplexRow}>
          <label>
            <input type="checkbox" checked={includeBack} onChange={(e) => setIncludeBack(e.target.checked)} />
            Include back (name, dates, venue)
          </label>
        </div>
        <p className={styles.duplexExplain}>
          With backs on, the printout is <strong>all front pages first</strong>, then <strong>all back pages</strong> in the same order—your browser does not flip
          paper inside the printer. Use one of these: print fronts, reload the stack into the tray <strong>flipped the way your printer expects for side 2</strong>,
          then print the back pages; or run one print job and use your printer&apos;s <strong>duplex</strong> settings only if your driver can match front/back
          (often easier with <strong>two separate prints</strong>: fronts only, then backs only).
        </p>
        <button type="button" className={styles.btnGhost} onClick={() => window.print()}>
          Print all badges
        </button>

        <div className={styles.printRoot} data-print-layout={printLayout} data-duplex={includeBack ? '1' : '0'}>
          {printLayout === '1up' &&
            members.map((m, i) => {
              const last = i === members.length - 1;
              return (
                <div key={m.user_id} className={styles.badgePair1up}>
                  <div
                    className={`${styles.badgePage} ${!includeBack && last ? styles.printLastInJob : ''}`}
                  >
                    <BadgeFace m={m} event={event} footerLine={footerLine} qrMap={qrMap} />
                  </div>
                  {includeBack && (
                    <div className={`${styles.badgePage} ${last ? styles.printLastInJob : ''}`}>
                      <BadgeBack m={m} event={event} footerLine={footerLine} />
                    </div>
                  )}
                </div>
              );
            })}

          {printLayout === '2up' &&
            (() => {
              const pairs = chunkMembers(members, 2);
              return (
                <>
                  {pairs.map((pair, sheetIdx) => (
                    <div
                      key={`f-${sheetIdx}`}
                      className={`${styles.printSheet2up} ${
                        !includeBack && sheetIdx === pairs.length - 1 ? styles.printLastSheet : ''
                      }`}
                    >
                      {pair.map((m) => (
                        <div key={m.user_id} className={styles.badgeSlot2up}>
                          <BadgeFace m={m} event={event} footerLine={footerLine} qrMap={qrMap} />
                        </div>
                      ))}
                    </div>
                  ))}
                  {includeBack
                    ? pairs.map((pair, sheetIdx) => (
                        <div
                          key={`b-${sheetIdx}`}
                          className={`${styles.printSheet2up} ${sheetIdx === pairs.length - 1 ? styles.printLastSheet : ''}`}
                        >
                          {pair.map((m) => (
                            <div key={m.user_id} className={styles.badgeSlot2up}>
                              <BadgeBack m={m} event={event} footerLine={footerLine} />
                            </div>
                          ))}
                        </div>
                      ))
                    : null}
                </>
              );
            })()}

          {printLayout === '4up' &&
            (() => {
              const quads = chunkMembers(members, 4);
              return (
                <>
                  {quads.map((quad, sheetIdx) => (
                    <div
                      key={`f4-${sheetIdx}`}
                      className={`${styles.printSheet4up} ${
                        !includeBack && sheetIdx === quads.length - 1 ? styles.printLastSheet : ''
                      }`}
                    >
                      {padChunkToSize(quad, 4).map((m, cellIdx) => (
                        <div key={m?.user_id ?? `f4-${sheetIdx}-e${cellIdx}`} className={styles.badgeSlot4up}>
                          {m ? (
                            <BadgeFace m={m} event={event} footerLine={footerLine} qrMap={qrMap} />
                          ) : (
                            <div className={styles.badgeSlot4upEmpty} aria-hidden />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  {includeBack
                    ? quads.map((quad, sheetIdx) => (
                        <div
                          key={`b4-${sheetIdx}`}
                          className={`${styles.printSheet4up} ${sheetIdx === quads.length - 1 ? styles.printLastSheet : ''}`}
                        >
                          {padChunkToSize(quad, 4).map((m, cellIdx) => (
                            <div key={m?.user_id ?? `b4-${sheetIdx}-e${cellIdx}`} className={styles.badgeSlot4up}>
                              {m ? (
                                <BadgeBack m={m} event={event} footerLine={footerLine} />
                              ) : (
                                <div className={styles.badgeSlot4upEmpty} aria-hidden />
                              )}
                            </div>
                          ))}
                        </div>
                      ))
                    : null}
                </>
              );
            })()}
        </div>
      </section>
    </div>
  );
}
