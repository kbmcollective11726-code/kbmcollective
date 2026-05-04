'use client';

import { useSearchParams } from 'next/navigation';
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  useId,
  useLayoutEffect,
} from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import {
  getNowNextSessions,
  formatSessionTime,
  type SessionForNowNext,
} from '../../lib/scheduleNowNext';
import { normalizeLiveWallSponsorImageUrl } from '../../lib/sponsorImageUrl';

const MOBILE_BREAKPOINT = 768;

function useWindowWidth() {
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    setWidth(window.innerWidth);
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/** KBM Collective brand palette — classic, modern conference wall */
const COLORS = {
  navy: '#1a2332',
  slate: '#2d3e50',
  champagne: '#c9a961',
  bronze: '#d4b574',
  teal: '#1e4d4d',
  steel: '#6c757d',
  coolWhite: '#f8f9fa',
  bg: '#1a2332',
  header: '#222b3a',
  card: '#2d3e50',
  accent: '#c9a961',
  accentSoft: '#d4b574',
  text: '#f8f9fa',
  textMuted: 'rgba(248, 249, 250, 0.72)',
  photoBg: '#152032',
  /** Leaderboard medals */
  rankGold: '#c9a961',
  rankSilver: '#adb5bd',
  rankBronze: '#d4b574',
  rankRest: '#6c757d',
};

type LiveWallSponsor = {
  id: string;
  company_name: string;
  logo_url: string | null;
  website_url: string | null;
  tier_label: string | null;
};

/**
 * WebKit/Chromium can show black bands around `<img>` under CSS transforms — use `translateZ(0)` /
 * `backfaceVisibility` on the image. Keep the **slot** background the same as the sponsor strip
 * (`slate` / transparent); a darker `photoBg` chip behind a white logo reads as black “shadow” bars.
 */
function SponsorWallImgBlock({
  logoUrl,
  companyName,
  tierLabel,
  imgStyle,
  fallbackFontSize = 12,
}: {
  logoUrl: string | null | undefined;
  companyName: string;
  tierLabel: string | null;
  imgStyle: CSSProperties;
  fallbackFontSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = useMemo(() => normalizeLiveWallSponsorImageUrl(logoUrl), [logoUrl]);
  const title = tierLabel ? `${tierLabel}: ${companyName}` : companyName;

  if (!url || failed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 10px',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            color: COLORS.champagne,
            fontWeight: 700,
            fontSize: fallbackFontSize,
            textAlign: 'center',
            lineHeight: 1.2,
            display: 'block',
          }}
        >
          {companyName}
        </span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={companyName}
      title={title}
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer-when-downgrade"
      style={{
        ...imgStyle,
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
      }}
      onError={() => setFailed(true)}
    />
  );
}

/** Pixels travelled per second along the sponsor path (single-sponsor seamless segment). */
/** Lower px/s = slower scroll for the single-sponsor seamless loop. */
const SINGLE_SWEEP_SPEED_PX = 65;
/** Gap between duplicated logo copies for a seamless loop (no empty rail between cycles). */
const SINGLE_SPONSOR_DUPLICATE_GAP_PX = 36;

function SingleSponsorSweepRail({
  sponsor,
  slotRadius,
  isMobile,
  windowWidth,
}: {
  sponsor: LiveWallSponsor;
  slotRadius: number;
  isMobile: boolean;
  windowWidth: number;
}) {
  const idSafe = useId().replace(/[^a-zA-Z0-9_-]/g, '') || 's';
  const railRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const [railPx, setRailPx] = useState(() =>
    Math.max(280, Math.floor((typeof window !== 'undefined' ? window.innerWidth : windowWidth) * 0.52)),
  );
  const [tilePx, setTilePx] = useState(320);

  useLayoutEffect(() => {
    const rail = railRef.current;
    const mover = moverRef.current;
    if (!rail || typeof ResizeObserver === 'undefined') return;

    let raf = 0;
    const measure = () => {
      setRailPx(Math.max(64, rail.clientWidth));
      const first = mover?.firstElementChild as HTMLElement | undefined;
      const second = first?.nextElementSibling as HTMLElement | undefined;
      if (first) {
        const gap =
          second != null
            ? Math.max(0, second.offsetLeft - first.offsetLeft - first.offsetWidth)
            : SINGLE_SPONSOR_DUPLICATE_GAP_PX;
        setTilePx(Math.max(64, Math.ceil(first.offsetWidth + gap)));
      } else {
        setTilePx(Math.max(64, Math.ceil((mover?.getBoundingClientRect().width ?? 240) / 2)));
      }
    };

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(rail);
    if (mover) ro.observe(mover);
    measure();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sponsor.id, sponsor.logo_url]);

  /** Wide banner slot — keep height modest so the sponsor row stays slim (logo uses `contain` inside). */
  const bannerW = railPx > 80 ? Math.max(220, railPx - 8) : Math.max(280, Math.floor(windowWidth * 0.5));
  const bannerH = Math.min(isMobile ? 52 : 60, Math.max(36, Math.floor(bannerW * 0.12)));

  /** One segment = one logo copy + gap; duplicate copies make the loop seamless (no dead air). */
  const segmentPx = tilePx;
  const durSec = Math.min(110, Math.max(14, segmentPx / SINGLE_SWEEP_SPEED_PX));
  /** Name encodes px so keyframe updates always match (some engines cache by name only). */
  const animName = `sponsor_sweep_${idSafe}_0_${segmentPx}`;

  const href = (sponsor.website_url || '').trim();

  const shell: CSSProperties = {
    display: 'block',
    width: bannerW,
    height: bannerH,
    borderRadius: slotRadius,
    overflow: 'hidden',
    lineHeight: 0,
    /** Same tone as sponsor row — avoids dark pillars beside a white opaque logo. */
    background: 'transparent',
  };

  const imgStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center',
  };

  const moverInner = (
    <div style={shell}>
      <SponsorWallImgBlock
        logoUrl={sponsor.logo_url}
        companyName={sponsor.company_name}
        tierLabel={sponsor.tier_label}
        imgStyle={imgStyle}
      />
    </div>
  );

  const linkStyle: CSSProperties = {
    textDecoration: 'none',
    color: 'inherit',
    outline: 'none',
    lineHeight: 0,
    display: 'inline-block',
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes ${animName} {
          0% { transform: translate3d(0, -50%, 0); }
          100% { transform: translate3d(${-segmentPx}px, -50%, 0); }
        }
      `,
        }}
      />
      <div
        ref={railRef}
        style={{
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
          minHeight: bannerH + 6,
          marginTop: 0,
          marginBottom: 0,
        }}
      >
        <div
          ref={moverRef}
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: SINGLE_SPONSOR_DUPLICATE_GAP_PX,
            animation: `${animName} ${durSec}s linear infinite`,
            willChange: 'transform',
          }}
        >
          {href ? (
            <>
              <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle} title={`Visit ${sponsor.company_name}`}>
                {moverInner}
              </a>
              <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle} title={`Visit ${sponsor.company_name}`}>
                {moverInner}
              </a>
            </>
          ) : (
            <>
              {moverInner}
              {moverInner}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function WallPageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventStartDate, setEventStartDate] = useState<string | null>(null);
  const [eventEndDate, setEventEndDate] = useState<string | null>(null);
  const [wallClockTick, setWallClockTick] = useState(0);
  const [stats, setStats] = useState({ photos: 0, likes: 0, comments: 0, participants: 0 });
  const [posts, setPosts] = useState<any[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [sessions, setSessions] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [liveComments, setLiveComments] = useState<any[]>([]);
  const [featuredComments, setFeaturedComments] = useState<any[]>([]);
  const [liveWallSponsors, setLiveWallSponsors] = useState<
    { id: string; company_name: string; logo_url: string | null; website_url: string | null; tier_label: string | null }[]
  >([]);
  const featuredPostIdRef = useRef<string | null>(null);

  const featuredPost = posts[featuredIndex] ?? null;
  featuredPostIdRef.current = featuredPost?.id ?? null;

  useEffect(() => {
    const id = setInterval(() => setWallClockTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchEventAndStats = useCallback(() => {
    if (!eventId || !supabase) return;
    supabase
      .from('events')
      .select('name, start_date, end_date')
      .eq('id', eventId)
      .single()
      .then(({ data }: any) => {
        setEventName(data?.name ?? '');
        setEventStartDate(typeof data?.start_date === 'string' ? data.start_date : null);
        setEventEndDate(typeof data?.end_date === 'string' ? data.end_date : null);
      });

    Promise.all([
      supabase.from('posts').select('id, likes_count, comments_count').eq('event_id', eventId).eq('is_deleted', false).eq('is_approved', true),
      supabase.from('event_members').select('user_id', { count: 'exact', head: true }).eq('event_id', eventId),
    ]).then(([postsRes, membersRes]) => {
      const postList = (postsRes.data ?? []) as any[];
      const totalLikes = postList.reduce((s, p) => s + (p.likes_count || 0), 0);
      const totalComments = postList.reduce((s, p) => s + (p.comments_count || 0), 0);
      setStats({
        photos: postList.length,
        likes: totalLikes,
        comments: totalComments,
        participants: (membersRes as any).count ?? 0,
      });
    });
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !supabase) return;
    fetchEventAndStats();

    supabase
      .from('posts')
      .select('id, image_url, caption, likes_count, comments_count, created_at, user:users(full_name)')
      .eq('event_id', eventId)
      .eq('is_deleted', false)
      .eq('is_approved', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }: any) => setPosts(data ?? []));

    supabase
      .from('schedule_sessions')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('day_number')
      .order('start_time')
      .then(({ data }: any) => setSessions(data ?? []));

    supabase
      .from('event_sponsors')
      .select('id, company_name, logo_url, website_url, tier_label, sort_order')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .eq('show_on_live_wall', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .then(({ data }: any) => setLiveWallSponsors(data ?? []));

    supabase
      .from('event_members')
      .select('user_id, points, users!inner(full_name, avatar_url, title)')
      .eq('event_id', eventId)
      .order('points', { ascending: false })
      .limit(10)
      .then(({ data }: any) => setLeaderboard(data ?? []));

    const fetchLiveComments = () => {
      supabase
        .from('posts')
        .select('id')
        .eq('event_id', eventId)
        .eq('is_deleted', false)
        .eq('is_approved', true)
        .limit(200)
        .then(({ data: postRows }: any) => {
          const postIds = (postRows ?? []).map((p: any) => p.id);
          if (postIds.length === 0) {
            setLiveComments([]);
            return;
          }
          // Chunk post IDs (some Supabase/PostgREST setups limit .in() size); merge and sort by created_at
          const CHUNK = 50;
          const promises = [];
          for (let i = 0; i < postIds.length; i += CHUNK) {
            const chunk = postIds.slice(i, i + CHUNK);
            promises.push(
              supabase
                .from('comments')
                .select('id, content, created_at, user:users(full_name)')
                .in('post_id', chunk)
                .order('created_at', { ascending: false })
                .limit(100)
            );
          }
          Promise.all(promises).then((results) => {
            const merged = (results.flatMap((r: any) => r.data ?? []) as any[])
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const unique = merged.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
            setLiveComments(unique.slice(0, 100));
          });
        });
    };
    fetchLiveComments();
    // Periodic refetch so new comments from other users show up even if realtime lags
    const interval = setInterval(fetchLiveComments, 20000);

    const ch = supabase
      .channel('wall-summit')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `event_id=eq.${eventId}` }, () => {
        supabase.from('posts').select('id, image_url, caption, likes_count, comments_count, created_at, user:users(full_name)').eq('event_id', eventId).eq('is_deleted', false).eq('is_approved', true).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50).then(({ data }: any) => setPosts(data ?? []));
        fetchEventAndStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, () => fetchEventAndStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
        fetchLiveComments();
        const pid = featuredPostIdRef.current;
        if (pid) {
          supabase.from('comments').select('id, content, created_at, user:users(full_name)').eq('post_id', pid).order('created_at', { ascending: false }).limit(10).then(({ data }: any) => setFeaturedComments(data ?? []));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_members', filter: `event_id=eq.${eventId}` }, () => {
        fetchEventAndStats();
        supabase.from('event_members').select('user_id, points, users!inner(full_name, avatar_url, title)').eq('event_id', eventId).order('points', { ascending: false }).limit(10).then(({ data }: any) => setLeaderboard(data ?? []));
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, [eventId, fetchEventAndStats]);

  useEffect(() => {
    if (!featuredPost?.id || !supabase) {
      if (!featuredPost?.id) setFeaturedComments([]);
      return;
    }
    supabase
      .from('comments')
      .select('id, content, created_at, user:users(full_name)')
      .eq('post_id', featuredPost.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }: any) => setFeaturedComments(data ?? []));
  }, [featuredPost?.id]);

  // Rotate featured post every 15s if multiple posts
  useEffect(() => {
    if (posts.length <= 1) return;
    const t = setInterval(() => {
      setFeaturedIndex((i) => (i + 1) % posts.length);
    }, 15000);
    return () => clearInterval(t);
  }, [posts.length]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const { nowSessions, nextSessions } = useMemo(() => {
    const list = (sessions ?? []) as SessionForNowNext[];
    if (!eventStartDate || list.length === 0) return { nowSessions: [] as SessionForNowNext[], nextSessions: [] as SessionForNowNext[] };
    return getNowNextSessions(list, eventStartDate, eventEndDate);
  }, [sessions, eventStartDate, eventEndDate, wallClockTick]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Ignore user gesture / browser permission errors.
    }
  }, []);

  if (!eventId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: COLORS.text }}>
        <p>Missing event. <Link href="/" style={{ color: COLORS.accent }}>Choose event</Link></p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${COLORS.navy} 0%, #161e2c 100%)`,
        color: COLORS.text,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes wall-ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        /* translate3d avoids GPU “black bands” around <img> seen with translateX on Chrome/Chromium. */
        @keyframes sponsor-marquee {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .wall-scroll-hidden {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .wall-scroll-hidden::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
      `,
        }}
      />
      {/* Header */}
      <header
        style={{
          background: COLORS.header,
          padding: isMobile ? '14px 18px' : '18px 36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: isMobile ? 12 : 16,
          borderBottom: `2px solid ${COLORS.accent}`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              border: '1px solid rgba(201, 169, 97, 0.45)',
              background: 'rgba(201, 169, 97, 0.14)',
              color: COLORS.champagne,
              borderRadius: 8,
              padding: isMobile ? '6px 10px' : '7px 12px',
              fontSize: isMobile ? 11 : 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          >
            {isFullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}
          </button>
          <span
            aria-hidden
            style={{
              width: 3,
              height: isMobile ? 22 : 28,
              background: COLORS.accent,
              borderRadius: 1,
              flexShrink: 0,
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: isMobile ? 15 : 20,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: COLORS.coolWhite,
            }}
          >
            {eventName || 'Loading…'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: isMobile ? 16 : 40, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatBlock value={stats.photos} label="PHOTOS SHARED" />
          <StatBlock value={stats.likes} label="LIKES GIVEN" />
          <StatBlock value={stats.comments} label="COMMENTS" />
          <StatBlock value={stats.participants} label="PARTICIPANTS" />
        </div>
      </header>

      {liveWallSponsors.length > 0 ? (
        <div
          style={{
            background: COLORS.slate,
            borderBottom: `1px solid rgba(201, 169, 97, 0.35)`,
            padding: isMobile ? '6px 12px' : '8px 20px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: isMobile ? 10 : 14,
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 0,
          }}
        >
          <span
            style={{
              fontSize: isMobile ? 9 : 11,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: COLORS.champagne,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              lineHeight: 1.15,
            }}
          >
            THANKS TO OUR SPONSORS
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            {/** Marquee for all counts. Single sponsor uses one-at-a-time pass across the rail. */}
            {(() => {
              const n = liveWallSponsors.length;
              /** Match sidebar / card radius (Happening Now, etc.). */
              const SLOT_RADIUS = 8;
              const laneH = isMobile ? 44 : 52;

              /** One sponsor: wide banner + slower measured sweep. */
              if (n === 1) {
                return (
                  <SingleSponsorSweepRail
                    sponsor={liveWallSponsors[0]!}
                    slotRadius={SLOT_RADIUS}
                    isMobile={isMobile}
                    windowWidth={windowWidth}
                  />
                );
              }

              /** Multi: fixed-width chips so the -50% marquee loop stays even. */
              const cardW = isMobile
                ? Math.min(260, Math.max(200, Math.floor(windowWidth * 0.36)))
                : Math.min(300, Math.max(220, Math.floor(windowWidth * 0.26)));

              const logoShell = {
                width: cardW,
                height: laneH,
                boxSizing: 'border-box' as const,
                borderRadius: SLOT_RADIUS,
                overflow: 'hidden' as const,
                background: 'transparent',
                flexShrink: 0,
                lineHeight: 0,
              };

              const imgStyle = {
                display: 'block' as const,
                width: '100%' as const,
                height: '100%' as const,
                objectFit: 'contain' as const,
                objectPosition: 'center' as const,
              };

              const renderTile = (s: (typeof liveWallSponsors)[number], roundKey: string) => {
                const href = (s.website_url || '').trim();
                const keyBase = `${s.id}-${roundKey}`;
                const inner = (
                  <div style={logoShell}>
                    <SponsorWallImgBlock
                      logoUrl={s.logo_url}
                      companyName={s.company_name}
                      tierLabel={s.tier_label}
                      imgStyle={imgStyle}
                    />
                  </div>
                );
                const linkWrap = {
                  display: 'flex',
                  alignItems: 'center',
                  textDecoration: 'none' as const,
                  lineHeight: 0,
                  flexShrink: 0,
                  outline: 'none' as const,
                  color: 'inherit' as const,
                };
                return href ? (
                  <a
                    key={keyBase}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkWrap}
                    title={
                      s.tier_label ? `${s.tier_label}: ${s.company_name}` : `Visit ${s.company_name}`
                    }
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={keyBase} style={linkWrap}>
                    {inner}
                  </div>
                );
              };

              /** Multi-sponsor: two wrapped rows so -50% equals exactly one sponsor set (seamless loop). */
              const chipGap = isMobile ? 22 : 28;
              const durationSec = Math.min(130, Math.max(62, n * (isMobile ? 28 : 34)));

              return (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: 'max-content',
                    animation: `sponsor-marquee ${durationSec}s linear infinite`,
                    willChange: 'transform',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: chipGap }}>
                    {liveWallSponsors.map((s) => renderTile(s, 'a'))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: chipGap }}>
                    {liveWallSponsors.map((s) => renderTile(s, 'b'))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* Main: featured post + sidebar */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 18 : 28,
          padding: isMobile ? 18 : 28,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {/* Left: featured post */}
        <section style={{ flex: 1, minWidth: 0, minHeight: isMobile ? 280 : undefined, display: 'flex', flexDirection: 'column' }}>
          {featuredPost ? (
            <div
              style={{
                flex: 1,
                background: COLORS.card,
                borderRadius: 12,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid rgba(201, 169, 97, 0.15)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              }}
            >
              <div style={{ aspectRatio: '16/10', minHeight: 320, background: COLORS.photoBg }}>
                <img
                  src={featuredPost.image_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div style={{ padding: 24 }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{(featuredPost.user as any)?.full_name ?? 'Unknown'}</p>
                {featuredPost.caption && (
                  <p style={{ margin: '8px 0 0', fontSize: 18, color: COLORS.textMuted }}>{featuredPost.caption}</p>
                )}
                <div style={{ marginTop: 12, display: 'flex', gap: 24, alignItems: 'center', fontSize: 15, color: COLORS.textMuted }}>
                  <span>{featuredPost.likes_count ?? 0} likes</span>
                  <span>{featuredPost.comments_count ?? 0} comments</span>
                </div>
                {featuredComments.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLORS.textMuted}33` }}>
                    {featuredComments.slice(0, 4).map((c: any) => (
                      <p key={c.id} style={{ margin: '4px 0', fontSize: 15 }}>
                        <span style={{ color: COLORS.accent }}>{c.user?.full_name ?? 'Someone'}:</span>{' '}
                        {c.content}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                background: COLORS.card,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.textMuted,
                fontSize: 17,
                border: '1px solid rgba(201, 169, 97, 0.12)',
              }}
            >
              No posts yet. Share a photo from the app!
            </div>
          )}
        </section>

        {/* Right sidebar */}
        <aside style={{ width: isMobile ? '100%' : 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Happening Now & Next */}
          <div
            style={{
              background: COLORS.teal,
              borderRadius: 12,
              padding: 22,
              color: COLORS.coolWhite,
              border: '1px solid rgba(248, 249, 250, 0.12)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', opacity: 0.95 }}>
              HAPPENING NOW &amp; NEXT
            </h3>
            {nowSessions.length > 0 ? (
              <div style={{ fontSize: 14 }}>
                {nowSessions.map((s) => (
                  <p key={s.id} style={{ margin: '4px 0', fontWeight: 600 }}>
                    {s.title} — {formatSessionTime(s.start_time)}
                  </p>
                ))}
              </div>
            ) : nextSessions.length > 0 ? (
              <div style={{ fontSize: 14 }}>
                <p style={{ margin: '0 0 4px', opacity: 0.9 }}>Up next:</p>
                {nextSessions.map((s) => (
                  <p key={s.id} style={{ margin: '2px 0' }}>
                    {s.title} — {formatSessionTime(s.start_time)}
                  </p>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 14 }}>No events scheduled right now</p>
            )}
          </div>

          {/* Top Performers */}
          <div
            style={{
              background: COLORS.card,
              borderRadius: 12,
              padding: 22,
              flex: 1,
              minHeight: 280,
              maxHeight: 360,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid rgba(201, 169, 97, 0.12)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
            }}
          >
            <h3
              style={{
                margin: '0 0 18px',
                fontSize: 13,
                fontWeight: 700,
                color: COLORS.champagne,
                letterSpacing: '0.14em',
              }}
            >
              TOP PERFORMERS
            </h3>
            <div
              className="wall-scroll-hidden"
              style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}
            >
              {leaderboard.map((r, i) => {
                const rankColors = [COLORS.rankGold, COLORS.rankSilver, COLORS.rankBronze, COLORS.rankRest, COLORS.rankRest];
                const initials = ((r.users?.full_name ?? '?').split(' ').map((n: string) => n[0]).join('') || '?').slice(0, 2).toUpperCase();
                return (
                  <div
                    key={r.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 0',
                      borderBottom: i < leaderboard.length - 1 ? `1px solid ${COLORS.textMuted}22` : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        background: rankColors[i] ?? COLORS.rankRest,
                        color: COLORS.navy,
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: COLORS.steel,
                        color: COLORS.coolWhite,
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {r.users?.avatar_url ? (
                        <img src={r.users.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: 18, objectFit: 'cover' }} />
                      ) : (
                        initials
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{r.users?.full_name ?? 'Unknown'}</p>
                      {r.users?.title && (
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: COLORS.textMuted }}>{r.users.title}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.points ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Activity */}
          <div
            style={{
              background: COLORS.card,
              borderRadius: 12,
              padding: 22,
              flex: 1,
              minHeight: 240,
              maxHeight: 320,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid rgba(201, 169, 97, 0.12)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: COLORS.champagne, letterSpacing: '0.14em' }}>
              LIVE ACTIVITY
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: COLORS.textMuted }}>Comments from everyone at this event</p>
            <div className="wall-scroll-hidden" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {liveComments.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>No activity yet</p>
              ) : (
                liveComments.map((c: any) => (
                  <p key={c.id} style={{ margin: 0, fontSize: 13, lineHeight: 1.4 }}>
                    <span style={{ color: COLORS.accent, fontWeight: 600 }}>{c.user?.full_name ?? 'Someone'}</span>
                    {' commented: '}
                    <span style={{ color: COLORS.text }}>&quot;{c.content}&quot;</span>
                  </p>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Bottom scrolling ticker */}
      <BottomTicker
        eventName={eventName}
        leaderboard={leaderboard}
        posts={posts}
      />
    </div>
  );
}

function BottomTicker({
  eventName,
  leaderboard,
  posts,
}: {
  eventName: string;
  leaderboard: any[];
  posts: any[];
}) {
  const leaderName = leaderboard[0]?.users?.full_name;
  const leaderPoints = leaderboard[0]?.points ?? 0;
  const lastPoster = posts[0] ? (posts[0].user as any)?.full_name : null;
  const baseMessages = [
    { text: `Welcome to ${eventName || 'the event'}` },
    { text: 'Share photos to earn points' },
    { text: 'Like posts to engage with the community' },
    { text: 'Comment to join the conversation' },
    { text: 'Top performers earn recognition' },
  ];
  const dynamicMessages = [
    leaderName && { text: `${leaderName} leads with ${leaderPoints} points` },
    lastPoster && { text: `${lastPoster} recently shared a photo` },
  ].filter(Boolean) as { text: string }[];
  const messages = [...baseMessages, ...dynamicMessages];
  const tickerContent = messages.map((m, i) => (
    <span
      key={i}
      style={{
        whiteSpace: 'nowrap',
        marginRight: 56,
        fontSize: 14,
        color: COLORS.textMuted,
        letterSpacing: '0.03em',
      }}
    >
      {m.text}
    </span>
  ));
  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 48,
          background: COLORS.header,
          borderTop: `1px solid rgba(201, 169, 97, 0.35)`,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          zIndex: 100,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            animation: 'wall-ticker 56s linear infinite',
            width: 'max-content',
          }}
        >
          {tickerContent}
          {tickerContent}
        </div>
      </div>
      {/* Spacer so main content is not hidden behind fixed ticker */}
      <div style={{ height: 48, flexShrink: 0 }} />
    </>
  );
}

function StatBlock({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: COLORS.champagne, letterSpacing: '-0.02em' }}>{value}</p>
      <p style={{ margin: '6px 0 0', fontSize: 10, color: COLORS.textMuted, letterSpacing: '0.14em', fontWeight: 600 }}>
        {label}
      </p>
    </div>
  );
}
