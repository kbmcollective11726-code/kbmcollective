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
import {
  LIVE_WALL_SPONSORS_SELECT,
  resolveLiveWallSponsors,
  type LiveWallSponsorRow,
} from '../../lib/sponsorCreatives';
import { parseEngagementSettings, computePhotoOfHour } from '../../lib/wallEngagement';
import { fetchAllWallPosts } from '../../lib/wallPosts';
import { useWallEngagement } from '../../hooks/useWallEngagement';
import WallEngagementLayer, { WallHeartBursts, PhotoOfHourBadge } from '../../components/WallEngagementLayer';
import {
  loadPassState,
  markPostShown,
  pickNextFeaturedIndex,
  pickPreferredOrNextUnshown,
  pickStartupFeaturedIndex,
  rememberFeaturedPost,
} from '../../lib/wallFeaturedRotation';

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
 * WebKit/Chromium can show black bands around `<img>` under CSS transforms — avoid stacking
 * `translateZ` here (it ghosted sponsor logos). Use the uploaded URL as-is (cadmin already
 * clears white/light-gray plates on save).
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
        background: 'transparent',
      }}
      onError={() => setFailed(true)}
    />
  );
}

const SINGLE_SWEEP_SPEED_PX = 55;

/**
 * One sponsor: logo sweeps across the rail. Duplicate copy sits one full rail-width away
 * so only one logo is on screen at a time (seamless loop, no side-by-side pair).
 */
function SingleSponsorSweepRail({
  sponsor,
  isMobile,
  windowWidth,
}: {
  sponsor: LiveWallSponsor;
  isMobile: boolean;
  windowWidth: number;
}) {
  const idSafe = useId().replace(/[^a-zA-Z0-9_-]/g, '') || 's';
  const railRef = useRef<HTMLDivElement>(null);
  const [railPx, setRailPx] = useState(() =>
    Math.max(280, Math.floor((typeof window !== 'undefined' ? window.innerWidth : windowWidth) * 0.52)),
  );

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const measure = () => setRailPx(Math.max(64, rail.clientWidth));
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(rail);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sponsor.id, sponsor.logo_url]);

  const bannerW = isMobile
    ? Math.min(220, Math.max(150, Math.floor(windowWidth * 0.38)))
    : Math.min(280, Math.max(180, Math.floor(windowWidth * 0.22)));
  const bannerH = Math.min(isMobile ? 44 : 50, Math.max(34, Math.floor(bannerW * 0.2)));

  /** Travel one full rail so the twin stays off-screen until the first exits. */
  const segmentPx = Math.max(railPx + bannerW, railPx + 80);
  const durSec = Math.min(90, Math.max(18, segmentPx / SINGLE_SWEEP_SPEED_PX));
  const animName = `sponsor_sweep_${idSafe}_${segmentPx}`;

  const href = (sponsor.website_url || '').trim();

  const shell: CSSProperties = {
    display: 'block',
    width: bannerW,
    height: bannerH,
    borderRadius: 8,
    overflow: 'hidden',
    lineHeight: 0,
    /** Light plate for dark logo text — no backdrop-blur (ghosts under transform). */
    background: 'rgba(255, 255, 255, 0.92)',
    boxSizing: 'border-box',
    padding: isMobile ? '4px 8px' : '5px 10px',
    flexShrink: 0,
  };

  const imgStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center',
    background: 'transparent',
  };

  const linkStyle: CSSProperties = {
    textDecoration: 'none',
    color: 'inherit',
    outline: 'none',
    lineHeight: 0,
    display: 'inline-block',
    flexShrink: 0,
  };

  const renderTile = (key: string) => {
    const inner = (
      <div style={shell}>
        <SponsorWallImgBlock
          logoUrl={sponsor.logo_url}
          companyName={sponsor.company_name}
          tierLabel={sponsor.tier_label}
          imgStyle={imgStyle}
        />
      </div>
    );
    return href ? (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
        title={`Visit ${sponsor.company_name}`}
      >
        {inner}
      </a>
    ) : (
      <div key={key} style={{ flexShrink: 0, lineHeight: 0 }}>
        {inner}
      </div>
    );
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
          minHeight: bannerH + 4,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: Math.max(48, railPx - bannerW + 24),
            animation: `${animName} ${durSec}s linear infinite`,
          }}
        >
          {renderTile('a')}
          {renderTile('b')}
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
  const [eventReminderTimezone, setEventReminderTimezone] = useState<string | null>(null);
  const [wallClockTick, setWallClockTick] = useState(0);
  const [stats, setStats] = useState({ photos: 0, likes: 0, comments: 0, participants: 0 });
  const [posts, setPosts] = useState<any[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [sessions, setSessions] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [liveComments, setLiveComments] = useState<any[]>([]);
  const [featuredComments, setFeaturedComments] = useState<any[]>([]);
  const [liveWallSponsorsRaw, setLiveWallSponsorsRaw] = useState<LiveWallSponsorRow[]>([]);
  const featuredPostIdRef = useRef<string | null>(null);
  const startupFeaturedPickedRef = useRef(false);
  const pendingStartupIndexRef = useRef<number | null>(null);
  /** Round-robin cursor + pass progress (persisted so open/close continues the pass). */
  const rotationCursorRef = useRef(0);
  const shownIdsRef = useRef<string[]>([]);
  const pohBonusUsedRef = useRef(false);
  const prevPostIdsRef = useRef<string[]>([]);

  const photoOfHourPostId = useMemo(() => computePhotoOfHour(posts), [posts]);

  const featuredPost = posts[featuredIndex] ?? null;
  featuredPostIdRef.current = featuredPost?.id ?? null;

  // Keep featured index in range if the post list shrinks
  useEffect(() => {
    if (posts.length === 0) return;
    if (featuredIndex >= posts.length) {
      const idx = 0;
      rotationCursorRef.current = idx;
      setFeaturedIndex(idx);
    }
  }, [posts.length, featuredIndex]);

  // Reset startup picker when switching events
  useEffect(() => {
    startupFeaturedPickedRef.current = false;
    pendingStartupIndexRef.current = null;
    rotationCursorRef.current = 0;
    shownIdsRef.current = [];
    pohBonusUsedRef.current = false;
    prevPostIdsRef.current = [];
  }, [eventId]);

  // On open/reopen: resume after last featured photo; skip already-shown this pass
  useEffect(() => {
    if (!eventId || posts.length === 0 || startupFeaturedPickedRef.current) return;
    startupFeaturedPickedRef.current = true;
    const pass = loadPassState(eventId);
    const { index: idx, shownIds, pohBonusUsed } = pickStartupFeaturedIndex(
      posts,
      photoOfHourPostId,
      pass,
    );
    shownIdsRef.current = shownIds;
    pohBonusUsedRef.current = pohBonusUsed;
    pendingStartupIndexRef.current = idx;
    rotationCursorRef.current = idx;
    prevPostIdsRef.current = posts.map((p) => p.id);
    setFeaturedIndex(idx);
  }, [eventId, posts, photoOfHourPostId]);

  // Persist progress whenever a photo is featured (survives close/reopen)
  useEffect(() => {
    if (!eventId || !featuredPost?.id || !startupFeaturedPickedRef.current) return;
    if (pendingStartupIndexRef.current != null && featuredIndex !== pendingStartupIndexRef.current) return;
    pendingStartupIndexRef.current = null;
    shownIdsRef.current = markPostShown(shownIdsRef.current, featuredPost.id);
    rememberFeaturedPost(
      eventId,
      featuredPost.id,
      shownIdsRef.current,
      pohBonusUsedRef.current,
    );
  }, [eventId, featuredPost?.id, featuredIndex]);

  const engagementSettings = useMemo(() => parseEngagementSettings(searchParams), [searchParams]);
  const engagement = useWallEngagement({
    settings: engagementSettings,
    posts,
    featuredPost,
    leaderboard,
    liveComments,
    wallClockTick,
  });

  const refetchPosts = useCallback(() => {
    if (!eventId || !supabase) return;
    void fetchAllWallPosts(supabase, eventId).then((data) => {
      setPosts((prev) => {
        if (
          prev.length === data.length &&
          prev.every((p, i) => p?.id === data[i]?.id && p?.likes_count === data[i]?.likes_count && p?.comments_count === data[i]?.comments_count)
        ) {
          return prev;
        }
        return data;
      });
    });
  }, [eventId]);

  const refetchLeaderboard = useCallback(() => {
    if (!eventId || !supabase) return;
    supabase
      .rpc('get_live_wall_leaderboard', { p_event_id: eventId, p_limit: 10 })
      .then(({ data }: { data: unknown }) => {
        const rows = Array.isArray(data) ? data : [];
        setLeaderboard(rows as typeof leaderboard);
      });
  }, [eventId]);

  // New photo arrives: feature it only if it has not been shown this pass (never force a repeat)
  useEffect(() => {
    if (!startupFeaturedPickedRef.current || posts.length === 0) {
      prevPostIdsRef.current = posts.map((p) => p.id);
      return;
    }
    const prevIds = new Set(prevPostIdsRef.current);
    const newest = posts[0];
    prevPostIdsRef.current = posts.map((p) => p.id);
    if (!newest?.id || prevIds.has(newest.id)) return;
    if (shownIdsRef.current.includes(newest.id)) return;

    const next = pickPreferredOrNextUnshown(
      posts,
      shownIdsRef.current,
      rotationCursorRef.current,
      newest.id,
      pohBonusUsedRef.current,
    );
    shownIdsRef.current = next.shownIds;
    pohBonusUsedRef.current = next.pohBonusUsed;
    rotationCursorRef.current = next.index;
    setFeaturedIndex(next.index);
  }, [posts]);

  useEffect(() => {
    const id = setInterval(() => setWallClockTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchEventAndStats = useCallback(() => {
    if (!eventId || !supabase) return;
    supabase.rpc('get_live_wall_event', { p_event_id: eventId }).then(({ data }: { data: any }) => {
      const row = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
      setEventName(row?.name ?? '');
      setEventStartDate(typeof row?.start_date === 'string' ? row.start_date : null);
      setEventEndDate(typeof row?.end_date === 'string' ? row.end_date : null);
      const tz = typeof row?.reminder_timezone === 'string' ? row.reminder_timezone.trim() : '';
      setEventReminderTimezone(tz || null);
    });

    Promise.all([
      fetchAllWallPosts(supabase, eventId),
      supabase.rpc('get_live_wall_member_count', { p_event_id: eventId }),
    ]).then(([postList, membersRes]) => {
      const totalLikes = postList.reduce((s, p) => s + (p.likes_count || 0), 0);
      const totalComments = postList.reduce((s, p) => s + (p.comments_count || 0), 0);
      const countRaw = (membersRes as { data?: unknown }).data;
      const participants = typeof countRaw === 'number' ? countRaw : Number(countRaw) || 0;
      setStats({
        photos: postList.length,
        likes: totalLikes,
        comments: totalComments,
        participants,
      });
      // Keep posts in sync for stats/poll without forcing a new array when unchanged
      setPosts((prev) => {
        if (
          prev.length === postList.length &&
          prev.every((p, i) => p?.id === postList[i]?.id && p?.likes_count === postList[i]?.likes_count && p?.comments_count === postList[i]?.comments_count)
        ) {
          return prev;
        }
        return postList;
      });
    });
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !supabase) return;
    fetchEventAndStats();

    void fetchAllWallPosts(supabase, eventId).then((data) => setPosts(data));

    supabase
      .rpc('get_live_wall_sessions', { p_event_id: eventId })
      .then(({ data }: any) => setSessions(Array.isArray(data) ? data : []));

    supabase
      .from('event_sponsors')
      .select(LIVE_WALL_SPONSORS_SELECT)
      .eq('event_id', eventId)
      .eq('is_active', true)
      .eq('show_on_live_wall', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .then(({ data }: any) => setLiveWallSponsorsRaw(data ?? []));

    refetchLeaderboard();

    const fetchLiveComments = () => {
      supabase
        .rpc('get_live_wall_comments', { p_event_id: eventId, p_limit: 100 })
        .then(({ data }: any) => setLiveComments(Array.isArray(data) ? data : []));
    };
    fetchLiveComments();
    // Polling drives updates after RLS lockdown (anon realtime on posts/comments is blocked).
    const interval = setInterval(fetchLiveComments, 20000);
    // Stats/leaderboard every 12s; posts refresh inside fetchEventAndStats only when content changes
    // so the 15s featured rotation timer is not constantly reset.
    const leaderboardInterval = setInterval(() => {
      fetchEventAndStats();
      refetchLeaderboard();
    }, 12000);

    return () => {
      clearInterval(interval);
      clearInterval(leaderboardInterval);
    };
  }, [eventId, fetchEventAndStats, refetchLeaderboard]);

  useEffect(() => {
    if (!featuredPost?.id || !supabase) {
      if (!featuredPost?.id) setFeaturedComments([]);
      return;
    }
    supabase
      .rpc('get_live_wall_comments_for_post', { p_post_id: featuredPost.id, p_limit: 10 })
      .then(({ data }: any) => setFeaturedComments(Array.isArray(data) ? data : []));
  }, [featuredPost?.id]);

  // Rotate every 15s — use refs so polling/stats updates don't reset the timer
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const photoOfHourRef = useRef(engagement.photoOfHourPostId);
  photoOfHourRef.current = engagement.photoOfHourPostId;

  useEffect(() => {
    if (posts.length <= 1) return;
    const t = setInterval(() => {
      const list = postsRef.current;
      if (list.length <= 1) return;
      const next = pickNextFeaturedIndex({
        posts: list,
        shownIds: shownIdsRef.current,
        fromIndex: rotationCursorRef.current,
        photoOfHourPostId: photoOfHourRef.current,
        pohBonusUsed: pohBonusUsedRef.current,
      });
      shownIdsRef.current = next.shownIds;
      pohBonusUsedRef.current = next.pohBonusUsed;
      rotationCursorRef.current = next.index;
      setFeaturedIndex(next.index);
    }, 15000);
    return () => clearInterval(t);
  }, [posts.length > 1]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const liveWallSponsors = useMemo(
    () => resolveLiveWallSponsors(liveWallSponsorsRaw, eventReminderTimezone, new Date()),
    [liveWallSponsorsRaw, eventReminderTimezone, wallClockTick]
  );

  const { nowSessions, nextSessions } = useMemo(() => {
    const list = (sessions ?? []) as SessionForNowNext[];
    if (!eventStartDate || list.length === 0) return { nowSessions: [] as SessionForNowNext[], nextSessions: [] as SessionForNowNext[] };
    return getNowNextSessions(list, eventStartDate, eventEndDate, eventReminderTimezone);
  }, [sessions, eventStartDate, eventEndDate, eventReminderTimezone, wallClockTick]);

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
            Live wall sponsored by
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
                background: 'rgba(255, 255, 255, 0.92)',
                padding: isMobile ? '4px 8px' : '5px 10px',
                flexShrink: 0,
                lineHeight: 0,
              };

              const imgStyle = {
                display: 'block' as const,
                width: '100%' as const,
                height: '100%' as const,
                objectFit: 'contain' as const,
                objectPosition: 'center' as const,
                background: 'transparent' as const,
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
              <div style={{ aspectRatio: '16/10', minHeight: 320, background: COLORS.photoBg, position: 'relative' }}>
                {engagement.photoOfHourPostId === featuredPost.id ? <PhotoOfHourBadge /> : null}
                <img
                  src={featuredPost.image_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <WallHeartBursts hearts={engagement.hearts} />
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
                const rankHighlighted = engagement.highlightedUserIds.has(r.user_id);
                return (
                  <div
                    key={r.user_id}
                    className={rankHighlighted ? 'wall-rank-highlight' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: rankHighlighted ? '10px 8px' : '10px 0',
                      margin: rankHighlighted ? '0 -8px' : 0,
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

      <WallEngagementLayer
        hero={engagement.hero}
        hearts={engagement.hearts}
        soundEnabled={engagement.soundEnabled}
        effectsEnabled={engagement.effectsEnabled}
        onToggleSound={engagement.toggleSound}
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
