import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import type { Event } from '../lib/types';
import { badgeHeroMedia, badgeHeroSourceLabel } from '../lib/badgeHeroMedia';
import { BADGE_BANNER_FILE_ACCEPT, BADGE_BANNER_HINT, BADGE_BANNER_SIZE_LABEL } from '../lib/badgeBannerHints';
import { uploadEventImage } from '../lib/uploadEventImage';
import styles from './EventBadges.module.css';

type MemberRow = {
  user_id: string;
  role: string;
  full_name: string;
  email: string;
  title: string | null;
  company: string | null;
  token: string | null;
};

import { badgeQrPayload } from '../lib/badgeQrUrl';

type BadgePrintLayout = '1up' | '2up' | '4up';
const BadgePrintLayoutContext = createContext<BadgePrintLayout>('1up');

/** Badge header: badge_banner_url → banner_url → logo_url. */
function BadgeHero({ event }: { event: Event | null }) {
  const mode = useContext(BadgePrintLayoutContext);
  const hero = badgeHeroMedia(event);
  const is4up = mode === '4up';

  if (!hero) {
    return <div className={styles.badgeHeroPlaceholder}>Upload a badge header image below (or set banner/logo on event)</div>;
  }

  const isBanner = hero.kind === 'badge-banner' || hero.kind === 'banner';

  if (isBanner) {
    const imgClass =
      hero.kind === 'badge-banner'
        ? `${styles.badgeHeroImgBanner} ${styles.badgeHeroImgBadgeBanner}`
        : hero.kind === 'banner'
          ? `${styles.badgeHeroImgBanner} ${styles.badgeHeroImgAppBannerFallback}`
          : styles.badgeHeroImgBanner;
    const heroWrapClass =
      hero.kind === 'badge-banner'
        ? `${styles.badgeHero} ${styles.badgeHeroBanner} ${styles.badgeHeroBannerDedicated}${is4up ? ` ${styles.badgeHeroBanner4up}` : ''}`
        : hero.kind === 'banner'
          ? `${styles.badgeHero} ${styles.badgeHeroBanner} ${styles.badgeHeroBannerAppFallback}${is4up ? ` ${styles.badgeHeroBanner4up}` : ''}`
          : is4up
            ? `${styles.badgeHero} ${styles.badgeHeroBanner} ${styles.badgeHeroBanner4up}`
            : `${styles.badgeHero} ${styles.badgeHeroBanner}`;
    return (
      <div className={heroWrapClass}>
        <img src={hero.src} alt="" className={imgClass} />
      </div>
    );
  }

  return (
    <div className={`${styles.badgeHero} ${styles.badgeHeroLogoWrap}`}>
      <img src={hero.src} alt="" className={styles.badgeHeroImgContain} />
    </div>
  );
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
  showEventName,
  footerLine,
  qrMap,
}: {
  m: MemberRow;
  event: Event | null;
  showEventName: boolean;
  footerLine: string;
  qrMap: Record<string, string>;
}) {
  return (
    <div className={styles.badgeInner}>
      <BadgeHero event={event} />
      <div className={styles.badgeBody}>
        {showEventName ? <div className={styles.badgeTitle}>{event?.name ?? 'Event'}</div> : null}
        <div className={styles.name}>{m.full_name}</div>
        {m.title?.trim() ? <div className={styles.memberTitle}>{m.title.trim()}</div> : null}
        <div className={styles.company}>{m.company?.trim() || '—'}</div>
        <div className={styles.qrWrap}>
          {m.token && qrMap[m.user_id] ? (
            <img src={qrMap[m.user_id]} alt="" width={148} height={148} />
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
  showEventName,
  footerLine,
}: {
  m: MemberRow;
  event: Event | null;
  showEventName: boolean;
  footerLine: string;
}) {
  const dates = formatEventDates(event);
  return (
    <div className={`${styles.badgeInner} ${styles.badgeInnerBack}`}>
      <BadgeHero event={event} />
      <div className={styles.badgeBody}>
        {showEventName ? <div className={styles.badgeTitle}>{event?.name ?? 'Event'}</div> : null}
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
  const [showEventName, setShowEventName] = useState(true);
  const [error, setError] = useState('');
  /** 1up = one 3.75″×5.5″ per page; 2up = two on Letter; 4up = four on Letter (2×2). */
  const [printLayout, setPrintLayout] = useState<'1up' | '2up' | '4up'>('4up');
  /** Print a second sheet per attendee with event + name (duplex or separate print pass). */
  const [includeBack, setIncludeBack] = useState(false);
  const [uploadingBadgeBanner, setUploadingBadgeBanner] = useState(false);
  const badgeBannerInputRef = useRef<HTMLInputElement>(null);

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
        .select('id, name, venue, logo_url, banner_url, badge_banner_url, badge_host_footer, badge_show_event_name, start_date, end_date')
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      const e = ev as Event & { badge_host_footer?: string | null };
      setEvent(e as Event);
      setFooterLine(e.badge_host_footer ?? '');
      setShowEventName(e.badge_show_event_name !== false);

      const { data: memRaw, error: memErr } = await supabase
        .from('event_members')
        .select('user_id, role, users!inner(full_name, email, title, company)')
        .eq('event_id', eventId);
      if (memErr) throw memErr;

      const { data: tokRows, error: tokErr } = await supabase
        .from('event_badge_tokens')
        .select('user_id, token')
        .eq('event_id', eventId);
      if (tokErr) throw tokErr;

      const byUser = new Map((tokRows ?? []).map((r: { user_id: string; token: string }) => [r.user_id, r.token]));

      const rows: MemberRow[] = (memRaw ?? []).map((r: Record<string, unknown>) => {
        const u = r.users as { full_name?: string; email?: string; title?: string | null; company?: string | null };
        const uid = r.user_id as string;
        return {
          user_id: uid,
          role: String(r.role ?? 'attendee'),
          full_name: u?.full_name ?? '—',
          email: u?.email ?? '',
          title: u?.title ?? null,
          company: u?.company ?? null,
          token: byUser.get(uid) ?? null,
        };
      });
      rows.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' }));
      setMembers(rows);

      const nextQr: Record<string, string> = {};
      for (const m of rows) {
        if (m.token) {
          nextQr[m.user_id] = await QRCode.toDataURL(badgeQrPayload(m.token), {
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
        .update({
          badge_host_footer: footerLine.trim() || null,
          badge_show_event_name: showEventName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventId);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setSavingFooter(false);
    }
  };

  const persistBadgeBanner = async (badge_banner_url: string | null) => {
    if (!eventId) return;
    const { error: err } = await supabase
      .from('events')
      .update({ badge_banner_url, updated_at: new Date().toISOString() })
      .eq('id', eventId);
    if (err) throw err;
  };

  const onBadgeBannerFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !eventId) return;
    setError('');
    setUploadingBadgeBanner(true);
    try {
      const url = await uploadEventImage(file, eventId, 'badge-banner');
      await persistBadgeBanner(url);
      setEvent((prev) => (prev ? { ...prev, badge_banner_url: url } : prev));
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setUploadingBadgeBanner(false);
    }
  };

  const onClearBadgeBanner = async () => {
    if (!eventId) return;
    setError('');
    setUploadingBadgeBanner(true);
    try {
      await persistBadgeBanner(null);
      setEvent((prev) => (prev ? { ...prev, badge_banner_url: null } : prev));
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setUploadingBadgeBanner(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const heroPreview = badgeHeroMedia(event);
  const headerSourceLabel = badgeHeroSourceLabel(event);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1 className={styles.pageTitle}>Badges — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        3.75″×5.5″ printable badges (sleeve-friendly) for every member. QR opens in KBM Connect — use <strong>Notes log</strong>{' '}
        on the event hub for app capture history (who scanned whom, notes, meetings).
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Badge header image</h2>
        <p className={styles.sectionHint}>
          {BADGE_BANNER_HINT} Recommended size: <strong>{BADGE_BANNER_SIZE_LABEL}</strong>. The app Info banner is unchanged.
        </p>
        <p className={styles.badgeHeaderSource}>{headerSourceLabel}</p>
        <input
          ref={badgeBannerInputRef}
          type="file"
          accept={BADGE_BANNER_FILE_ACCEPT}
          className={styles.hiddenFileInput}
          onChange={onBadgeBannerFile}
        />
        {heroPreview ? (
          <div className={styles.badgeHeaderPreviewWrap}>
            <img src={heroPreview.src} alt="" className={styles.badgeHeaderPreview} />
          </div>
        ) : (
          <div className={styles.badgeHeaderPreviewPlaceholder}>No header image yet</div>
        )}
        <div className={styles.badgeHeaderActions}>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={uploadingBadgeBanner}
            onClick={() => badgeBannerInputRef.current?.click()}
          >
            {uploadingBadgeBanner
              ? 'Uploading…'
              : event?.badge_banner_url
                ? 'Replace badge header'
                : 'Upload badge header'}
          </button>
          {event?.badge_banner_url ? (
            <button
              type="button"
              className={styles.btnGhost}
              disabled={uploadingBadgeBanner}
              onClick={onClearBadgeBanner}
            >
              Remove badge header
            </button>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Badge text settings</h2>
        <p className={styles.sectionHint}>Control text shown on badges and printed footer line.</p>
        <div className={styles.footerRow}>
          <input
            type="text"
            className={styles.input}
            value={footerLine}
            onChange={(e) => setFooterLine(e.target.value)}
            placeholder='e.g. Hosted by Opal Group — The HR Executive Summits Series'
          />
          <label className={styles.layoutOpt}>
            <input type="checkbox" checked={showEventName} onChange={(e) => setShowEventName(e.target.checked)} />
            Show event name on badge
          </label>
          <button type="button" className={styles.btnPrimary} onClick={saveFooter} disabled={savingFooter}>
            {savingFooter ? 'Saving…' : 'Save settings'}
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
          Use <strong>Print</strong> → <strong>Letter</strong> for multi-up. QR opens in KBM Connect — use <strong>Profile → Scan badge</strong> or your phone camera if it offers to open the app. Turn off{' '}
          <strong>Headers and footers</strong> in the print dialog. Header uses the <strong>badge header image</strong> when set, otherwise the app <strong>Info banner</strong>, then <strong>logo</strong>.
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

        <BadgePrintLayoutContext.Provider value={printLayout}>
        <div className={styles.printRoot} data-print-layout={printLayout} data-duplex={includeBack ? '1' : '0'}>
          {printLayout === '1up' &&
            members.map((m, i) => {
              const last = i === members.length - 1;
              return (
                <div key={m.user_id} className={styles.badgePair1up}>
                  <div
                    className={`${styles.badgePage} ${!includeBack && last ? styles.printLastInJob : ''}`}
                  >
                    <BadgeFace m={m} event={event} showEventName={showEventName} footerLine={footerLine} qrMap={qrMap} />
                  </div>
                  {includeBack && (
                    <div className={`${styles.badgePage} ${last ? styles.printLastInJob : ''}`}>
                      <BadgeBack m={m} event={event} showEventName={showEventName} footerLine={footerLine} />
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
                          <BadgeFace m={m} event={event} showEventName={showEventName} footerLine={footerLine} qrMap={qrMap} />
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
                              <BadgeBack m={m} event={event} showEventName={showEventName} footerLine={footerLine} />
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
                            <BadgeFace m={m} event={event} showEventName={showEventName} footerLine={footerLine} qrMap={qrMap} />
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
                                <BadgeBack m={m} event={event} showEventName={showEventName} footerLine={footerLine} />
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
        </BadgePrintLayoutContext.Provider>
      </section>
    </div>
  );
}
