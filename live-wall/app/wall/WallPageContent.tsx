'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

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

const COLORS = {
  bg: '#1e0a2e',
  header: '#2d1b4e',
  card: '#2d1b4e',
  accent: '#facc15',
  green: '#22c55e',
  text: '#ffffff',
  textMuted: '#e2e8f0',
  gold: '#fbbf24',
  silver: '#94a3b8',
  bronze: '#d97706',
  purple: '#7c3aed',
};

export default function WallPageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const [eventName, setEventName] = useState('');
  const [stats, setStats] = useState({ photos: 0, likes: 0, comments: 0, participants: 0 });
  const [posts, setPosts] = useState<any[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [sessions, setSessions] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [liveComments, setLiveComments] = useState<any[]>([]);
  const [featuredComments, setFeaturedComments] = useState<any[]>([]);
  const featuredPostIdRef = useRef<string | null>(null);

  const featuredPost = posts[featuredIndex] ?? null;
  featuredPostIdRef.current = featuredPost?.id ?? null;

  const fetchEventAndStats = useCallback(() => {
    if (!eventId || !supabase) return;
    supabase.from('events').select('name').eq('id', eventId).single().then(({ data }: any) => setEventName(data?.name ?? ''));

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

  if (!eventId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: COLORS.text }}>
        <p>Missing event. <Link href="/" style={{ color: COLORS.accent }}>Choose event</Link></p>
      </div>
    );
  }

  const now = new Date();
  const happeningNow = sessions.filter((s) => new Date(s.start_time) <= now && new Date(s.end_time) >= now);
  const nextUp = sessions.filter((s) => new Date(s.start_time) > now).slice(0, 2);

  function formatUpNextTime(iso: string) {
    const d = new Date(iso);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sessionDay.getTime() === today.getTime()) return `Today ${timeStr}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (sessionDay.getTime() === tomorrow.getTime()) return `Tomorrow ${timeStr}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeStr}`;
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          background: COLORS.header,
          padding: isMobile ? '12px 16px' : '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: isMobile ? 12 : 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link href="/" style={{ color: COLORS.textMuted, textDecoration: 'none', fontSize: 14, flexShrink: 0 }}>← Events</Link>
          <span style={{ marginLeft: 8, fontSize: isMobile ? 22 : 28, flexShrink: 0 }}>🏆</span>
          <h1 style={{ margin: 0, fontSize: isMobile ? 16 : 22, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {eventName || 'Loading…'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: isMobile ? 16 : 40, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatBlock value={stats.photos} label="PHOTOS SHARED" />
          <StatBlock value={stats.likes} label="LIKES GIVEN" />
          <StatBlock value={stats.comments} label="COMMENTS" />
          <StatBlock value={stats.participants} label="PARTICIPANTS" />
        </div>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.bg,
            fontWeight: 700,
            fontSize: 20,
          }}
          title="Event info"
        >
          i
        </div>
      </header>

      {/* Main: featured post + sidebar */}
      <main style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 24, padding: isMobile ? 16 : 24, minHeight: 0, overflow: 'auto' }}>
        {/* Left: featured post */}
        <section style={{ flex: 1, minWidth: 0, minHeight: isMobile ? 280 : undefined, display: 'flex', flexDirection: 'column' }}>
          {featuredPost ? (
            <div
              style={{
                flex: 1,
                background: COLORS.card,
                borderRadius: 16,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              }}
            >
              <div style={{ aspectRatio: '16/10', minHeight: 320, background: '#0f172a' }}>
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
                <div style={{ marginTop: 12, display: 'flex', gap: 20, alignItems: 'center', fontSize: 16, color: COLORS.textMuted }}>
                  <span>♥ {featuredPost.likes_count ?? 0} likes</span>
                  <span>💬 {featuredPost.comments_count ?? 0} comments</span>
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
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.textMuted,
                fontSize: 18,
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
              background: COLORS.green,
              borderRadius: 12,
              padding: 20,
              color: COLORS.bg,
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>• Happening Now & Next</h3>
            {happeningNow.length > 0 ? (
              <div style={{ fontSize: 14 }}>
                {happeningNow.map((s) => (
                  <p key={s.id} style={{ margin: '4px 0', fontWeight: 600 }}>{s.title}</p>
                ))}
              </div>
            ) : nextUp.length > 0 ? (
              <div style={{ fontSize: 14 }}>
                <p style={{ margin: '0 0 4px', opacity: 0.9 }}>Up next:</p>
                {nextUp.map((s) => (
                  <p key={s.id} style={{ margin: '2px 0' }}>
                    {s.title} — {formatUpNextTime(s.start_time)}
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
              padding: 20,
              flex: 1,
              minHeight: 280,
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: COLORS.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>💡</span> TOP PERFORMERS
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leaderboard.slice(0, 5).map((r, i) => {
                const rankColors = [COLORS.gold, COLORS.silver, COLORS.bronze, COLORS.purple, COLORS.purple];
                const initials = ((r.users?.full_name ?? '?').split(' ').map((n: string) => n[0]).join('') || '?').slice(0, 2).toUpperCase();
                return (
                  <div
                    key={r.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 0',
                      borderBottom: i < 4 ? `1px solid ${COLORS.textMuted}22` : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        background: rankColors[i] ?? COLORS.purple,
                        color: COLORS.bg,
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
                        background: COLORS.purple,
                        color: COLORS.text,
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.points ?? 0}</span>
                      {i < 3 && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: COLORS.accent,
                            background: `${COLORS.accent}22`,
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          PRIZE
                        </span>
                      )}
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
              padding: 20,
              flex: 1,
              minHeight: 240,
              maxHeight: 320,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: COLORS.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚡</span> LIVE ACTIVITY
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: COLORS.textMuted }}>Comments from everyone at this event</p>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
    { icon: '🎉', text: `Welcome to ${eventName || 'the event'}!` },
    { icon: '📸', text: 'Share your photos to earn 15 points!' },
    { icon: '❤️', text: 'Like posts to earn 5 points!' },
    { icon: '💬', text: 'Comment to earn 10 points!' },
    { icon: '🏆', text: 'TOP PERFORMERS WIN AMAZING PRIZES!' },
  ];
  const dynamicMessages = [
    leaderName && { icon: '⚡', text: `${leaderName} is leading with ${leaderPoints} points!` },
    lastPoster && { icon: '✨', text: `${lastPoster} just posted a photo!` },
  ].filter(Boolean) as { icon: string; text: string }[];
  const messages = [...baseMessages, ...dynamicMessages];
  const tickerContent = messages.map((m, i) => (
    <span key={i} style={{ whiteSpace: 'nowrap', marginRight: 48, fontSize: 15, color: COLORS.text }}>
      {m.icon} {m.text}
    </span>
  ));
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes wall-ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      ` }} />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 48,
          background: COLORS.header,
          borderTop: `1px solid ${COLORS.accent}33`,
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
            animation: 'wall-ticker 45s linear infinite',
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
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: COLORS.accent }}>{value}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12, color: COLORS.textMuted, letterSpacing: '0.02em' }}>{label}</p>
    </div>
  );
}
