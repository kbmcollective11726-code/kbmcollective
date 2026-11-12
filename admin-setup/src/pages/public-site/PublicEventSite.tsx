import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  eventMapHref,
  formatDayHeading,
  formatEventDateRange,
  formatWallClockTime,
  loadPublicEventSite,
  safeHttpUrl,
  sessionSpeakers,
  speakerKey,
  wallClockDayKey,
  type PublicEventSiteData,
  type PublicEventSiteUnavailable,
  type PublicSiteSession,
  type PublicSiteSpeaker,
} from '../../lib/publicEventSite';
import styles from './PublicEventSite.module.css';

type SitePage = 'home' | 'agenda' | 'faq';

const DEFAULT_ACCENT = '#1e4f8a';

function parsePage(raw: string | undefined): SitePage {
  return raw === 'agenda' || raw === 'faq' ? raw : 'home';
}

function accentColor(theme: string | null | undefined): string {
  const t = theme?.trim() ?? '';
  return /^#[0-9a-f]{6}$/i.test(t) || /^#[0-9a-f]{3}$/i.test(t) ? t : DEFAULT_ACCENT;
}

interface OpenSpeaker {
  speaker: PublicSiteSpeaker;
  sessions: PublicSiteSession[];
}

export default function PublicEventSite() {
  const { slug = '', page: pageParam } = useParams<{ slug: string; page?: string }>();
  const page = parsePage(pageParam);
  const [result, setResult] = useState<PublicEventSiteData | PublicEventSiteUnavailable | null>(null);
  const site = result?.status === 'live' ? result : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSpeaker, setOpenSpeaker] = useState<OpenSpeaker | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await loadPublicEventSite(slug);
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setError('This event page could not be loaded. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (result?.event.name) document.title = result.event.name;
  }, [result?.event.name]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  const days = useMemo(() => {
    const map = new Map<string, PublicSiteSession[]>();
    for (const s of site?.sessions ?? []) {
      const key = wallClockDayKey(s.start_time);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, sessions]) => ({ key, sessions }));
  }, [site?.sessions]);

  if (loading) {
    return <div className={styles.centered}>Loading…</div>;
  }
  if (error) {
    return <div className={styles.centered}>{error}</div>;
  }
  if (result && result.status !== 'live') {
    const accentOff = accentColor(result.event.theme_color);
    const logoOff = safeHttpUrl(result.event.logo_url);
    return (
      <div className={styles.centered}>
        <div className={styles.statusCard} style={{ borderTopColor: accentOff }}>
          {logoOff ? <img src={logoOff} alt="" className={styles.statusLogo} /> : null}
          <h1 className={styles.statusEventName}>{result.event.name}</h1>
          {result.status === 'off' ? (
            <>
              <p className={styles.statusHeadline}>This event page isn't live yet.</p>
              <p className={styles.muted}>Check back soon, or contact the event organizer for details.</p>
            </>
          ) : (
            <>
              <p className={styles.statusHeadline}>This event page is no longer available.</p>
              <p className={styles.muted}>The event has ended or been closed. Contact the event organizer with questions.</p>
            </>
          )}
        </div>
      </div>
    );
  }
  if (!site) {
    return (
      <div className={styles.centered}>
        <div className={styles.statusCard}>
          <h1 className={styles.statusEventName}>We couldn't find this event page</h1>
          <p className={styles.muted}>The link may be mistyped or out of date. Check it with the event organizer.</p>
        </div>
      </div>
    );
  }

  const { event } = site;
  const accent = accentColor(event.theme_color);
  const base = `/e/${encodeURIComponent(site.slug)}`;
  const registerHref = site.registration_open ? `${base}/register` : null;
  const banner = safeHttpUrl(event.banner_url) ?? safeHttpUrl(event.portal_banner_url);
  const logo = safeHttpUrl(event.logo_url);
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const place = [event.venue, event.location].filter((p) => p?.trim()).join(' · ');
  const mapHref = eventMapHref(event);

  const sessionsForSpeaker = (name: string | null | undefined) =>
    site.sessions.filter((s) => sessionSpeakers(s).some((sp) => speakerKey(sp.name) === speakerKey(name)));

  const renderRegisterButton = (large?: boolean) =>
    registerHref ? (
      <Link to={registerHref} className={large ? styles.registerBtnLarge : styles.registerBtn} style={{ background: accent }}>
        Register
      </Link>
    ) : (
      <span className={styles.registerClosed}>Registration closed</span>
    );

  const renderSpeakerChip = (sp: PublicSiteSpeaker, idx: number) => {
    const profile = site.speaker_profiles[speakerKey(sp.name)];
    const photo = safeHttpUrl(sp.photo) ?? safeHttpUrl(profile?.avatar_url);
    const subtitle = [sp.title || profile?.title, sp.company || profile?.company].filter(Boolean).join(', ');
    return (
      <button
        key={`${sp.name}-${idx}`}
        type="button"
        className={styles.speakerChip}
        onClick={() => setOpenSpeaker({ speaker: sp, sessions: sessionsForSpeaker(sp.name) })}
      >
        {photo ? (
          <img src={photo} alt="" className={styles.speakerChipPhoto} />
        ) : (
          <span className={styles.speakerChipInitial} style={{ background: accent }}>
            {(sp.name ?? '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
        <span className={styles.speakerChipText}>
          <span className={styles.speakerChipName}>{sp.name}</span>
          {subtitle ? <span className={styles.speakerChipTitle}>{subtitle}</span> : null}
        </span>
      </button>
    );
  };

  const renderSession = (s: PublicSiteSession) => {
    const speakers = sessionSpeakers(s);
    const where = [s.location, s.room].filter((p) => p?.trim()).join(' · ');
    return (
      <article key={s.id} className={styles.session}>
        <div className={styles.sessionTime} style={{ color: accent }}>
          {formatWallClockTime(s.start_time)}
          {s.end_time ? <span className={styles.sessionTimeEnd}>– {formatWallClockTime(s.end_time)}</span> : null}
        </div>
        <div className={styles.sessionBody}>
          <h3 className={styles.sessionTitle}>{s.title}</h3>
          {where ? <p className={styles.sessionWhere}>{where}</p> : null}
          {s.description?.trim() ? <p className={styles.sessionDesc}>{s.description}</p> : null}
          {speakers.length > 0 ? <div className={styles.speakerRow}>{speakers.map(renderSpeakerChip)}</div> : null}
        </div>
      </article>
    );
  };

  const openProfile = openSpeaker ? site.speaker_profiles[speakerKey(openSpeaker.speaker.name)] : null;
  const openPhoto = openSpeaker
    ? safeHttpUrl(openSpeaker.speaker.photo) ?? safeHttpUrl(openProfile?.avatar_url)
    : null;

  return (
    <div className={styles.page} style={{ ['--accent' as string]: accent }}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to={base} className={styles.brand}>
            {logo ? <img src={logo} alt="" className={styles.brandLogo} /> : null}
            <span className={styles.brandName}>{event.name}</span>
          </Link>
          <nav className={styles.nav} aria-label="Event pages">
            <Link to={base} className={page === 'home' ? styles.navActive : styles.navLink}>
              Home
            </Link>
            <Link to={`${base}/agenda`} className={page === 'agenda' ? styles.navActive : styles.navLink}>
              Agenda
            </Link>
            {site.faq.length > 0 ? (
              <Link to={`${base}/faq`} className={page === 'faq' ? styles.navActive : styles.navLink}>
                FAQ
              </Link>
            ) : null}
            {renderRegisterButton()}
          </nav>
        </div>
      </header>

      {page === 'home' ? (
        <main>
          <section className={styles.hero}>
            <div className={`${styles.heroInner} ${banner ? styles.heroInnerWithImage : ''}`}>
              {banner ? <img src={banner} alt="" className={styles.heroImage} /> : null}
              <div className={styles.heroBody}>
                <h1 className={styles.heroTitle}>{event.welcome_title?.trim() || event.name}</h1>
                {event.welcome_subtitle?.trim() ? <p className={styles.heroSubtitle}>{event.welcome_subtitle}</p> : null}
                <div className={styles.heroMeta}>
                  {dateRange ? <span>{dateRange}</span> : null}
                  {place ? <span>{place}</span> : null}
                </div>
                <div className={styles.heroActions}>
                  {renderRegisterButton(true)}
                  <Link to={`${base}/agenda`} className={styles.secondaryBtn}>
                    View agenda
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <div className={styles.content}>
            {event.welcome_message?.trim() || event.description?.trim() ? (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>About the event</h2>
                {event.welcome_message?.trim() ? <p className={styles.bodyText}>{event.welcome_message}</p> : null}
                {event.description?.trim() ? <p className={styles.bodyText}>{event.description}</p> : null}
              </section>
            ) : null}

            {(dateRange || place) ? (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>When &amp; where</h2>
                <dl className={styles.detailList}>
                  {dateRange ? (
                    <>
                      <dt>Dates</dt>
                      <dd>{dateRange}</dd>
                    </>
                  ) : null}
                  {event.venue?.trim() ? (
                    <>
                      <dt>Venue</dt>
                      <dd>{event.venue}</dd>
                    </>
                  ) : null}
                  {event.location?.trim() ? (
                    <>
                      <dt>Location</dt>
                      <dd>{event.location}</dd>
                    </>
                  ) : null}
                </dl>
                {mapHref ? (
                  <a href={mapHref} target="_blank" rel="noreferrer" className={styles.textLink}>
                    Open in maps
                  </a>
                ) : null}
              </section>
            ) : null}

            {site.sponsors.length > 0 ? (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Sponsors</h2>
                <div className={styles.sponsorGrid}>
                  {site.sponsors.map((sp) => {
                    const logoUrl = safeHttpUrl(sp.logo_url);
                    const href = safeHttpUrl(sp.website_url);
                    const inner = logoUrl ? (
                      <img src={logoUrl} alt={sp.company_name} className={styles.sponsorLogo} />
                    ) : (
                      <span className={styles.sponsorName}>{sp.company_name}</span>
                    );
                    return href ? (
                      <a key={sp.id} href={href} target="_blank" rel="noreferrer" className={styles.sponsorTile}>
                        {inner}
                      </a>
                    ) : (
                      <div key={sp.id} className={styles.sponsorTile}>
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </main>
      ) : null}

      {page === 'agenda' ? (
        <main className={styles.content}>
          <h1 className={styles.pageTitle}>Agenda</h1>
          {days.length === 0 ? (
            <p className={styles.muted}>The agenda will be posted soon.</p>
          ) : (
            days.map((day) => (
              <section key={day.key} className={styles.daySection}>
                <h2 className={styles.dayHeading}>{formatDayHeading(day.key)}</h2>
                <div className={styles.sessionList}>{day.sessions.map(renderSession)}</div>
              </section>
            ))
          )}
        </main>
      ) : null}

      {page === 'faq' ? (
        <main className={styles.content}>
          <h1 className={styles.pageTitle}>Frequently asked questions</h1>
          {site.faq.length === 0 ? (
            <p className={styles.muted}>No questions yet.</p>
          ) : (
            <div className={styles.faqList}>
              {site.faq.map((item, idx) => (
                <details key={idx} className={styles.faqItem}>
                  <summary className={styles.faqQuestion}>{item.question}</summary>
                  <p className={styles.faqAnswer}>{item.answer}</p>
                </details>
              ))}
            </div>
          )}
        </main>
      ) : null}

      <footer className={styles.footer}>
        <span>{event.name}</span>
        {renderRegisterButton()}
      </footer>

      {openSpeaker ? (
        <div className={styles.modalBackdrop} onClick={() => setOpenSpeaker(null)}>
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose} onClick={() => setOpenSpeaker(null)} aria-label="Close">
              ×
            </button>
            <div className={styles.modalHead}>
              {openPhoto ? (
                <img src={openPhoto} alt="" className={styles.modalPhoto} />
              ) : (
                <span className={styles.modalInitial} style={{ background: accent }}>
                  {(openSpeaker.speaker.name ?? '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
              <div>
                <h2 className={styles.modalName}>{openSpeaker.speaker.name}</h2>
                <p className={styles.modalTitle}>
                  {[
                    openSpeaker.speaker.title || openProfile?.title,
                    openSpeaker.speaker.company || openProfile?.company,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            </div>
            {openProfile?.bio?.trim() ? <p className={styles.bodyText}>{openProfile.bio}</p> : null}
            {openSpeaker.sessions.length > 0 ? (
              <>
                <h3 className={styles.modalSectionTitle}>Sessions</h3>
                <ul className={styles.modalSessions}>
                  {openSpeaker.sessions.map((s) => (
                    <li key={s.id}>
                      <strong>{s.title}</strong>
                      <span className={styles.muted}>
                        {' '}
                        {formatDayHeading(wallClockDayKey(s.start_time))} · {formatWallClockTime(s.start_time)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
