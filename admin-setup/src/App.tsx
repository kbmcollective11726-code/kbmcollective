import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import LoginEmailCode, {
  clearAwaitingPlatformAdminEmailOtp,
  isAwaitingPlatformAdminEmailOtp,
} from './pages/LoginEmailCode';
import EventList from './pages/EventList';
import EventNew from './pages/EventNew';
import EventDetail from './pages/EventDetail';
import EventEdit from './pages/EventEdit';
import Schedule from './pages/Schedule';
import AgendaPrint from './pages/AgendaPrint';
import Members from './pages/Members';
import B2BFeedback from './pages/B2BFeedback';
import SessionFeedback from './pages/SessionFeedback';
import BulkB2BAssign from './pages/BulkB2BAssign';

function RedirectBulkB2BToMeetings() {
  const { eventId } = useParams<{ eventId: string }>();
  return <Navigate to={`/events/${eventId}/meetings`} replace />;
}
import Announcements from './pages/Announcements';
import Dashboard from './pages/Dashboard';
import VendorBooths from './pages/VendorBooths';
import VendorBoothForm from './pages/VendorBoothForm';
import PlatformUsers from './pages/PlatformUsers';
import PlatformUserAudit from './pages/PlatformUserAudit';
import PlatformOwaspAsvs from './pages/PlatformOwaspAsvs';
import TestGuide from './pages/TestGuide';
import PlatformSupabaseCompute from './pages/PlatformSupabaseCompute';
import PlatformHealth from './pages/PlatformHealth';
import EventReadiness from './pages/EventReadiness';
import EventPhotos from './pages/EventPhotos';
import EventSponsors from './pages/EventSponsors';
import EventMatchmaking from './pages/EventMatchmaking';
import EventBadges from './pages/EventBadges';
import EventScanLog from './pages/EventScanLog';
import EventSessionAttendance from './pages/EventSessionAttendance';
import EventSessionAttendanceReport from './pages/EventSessionAttendanceReport';
import EventSafety from './pages/EventSafety';
import EventAdminTiles from './pages/EventAdminTiles';
import EventTroubleshooting from './pages/EventTroubleshooting';
import BadgeOpen from './pages/BadgeOpen';
import { portalRouteElements } from './PortalRoutes';
import ConnectHome from './pages/ConnectHome';
import { CADMIN_HOST, CONNECT_HOST, isConnectHost } from './lib/connectHost';
import {
  clearPlatformAdminEmailOtp,
  hasPlatformAdminEmailOtp,
  onPlatformAdminEmailOtpVerified,
} from './lib/platformAdminEmailOtp';
import { userNeedsCadminEmailOtp } from './lib/cadminAdminAccess';
import { rejectIfAccountDeactivated } from './lib/accountActive';

function UnauthenticatedEntry() {
  if (isConnectHost()) return <ConnectHome />;
  return <Navigate to="/login" replace />;
}

function ConnectHostRedirect() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hostname !== CONNECT_HOST) return;
    const isAdminPath =
      location.pathname.startsWith('/events') ||
      location.pathname.startsWith('/platform') ||
      location.pathname === '/login' ||
      location.pathname.startsWith('/login/');
    if (isAdminPath) {
      window.location.replace(`https://${CADMIN_HOST}${location.pathname}${location.search}${location.hash}`);
    }
  }, [location]);
  return null;
}

export default function App() {
  const location = useLocation();
  const isPortalRoute = location.pathname.startsWith('/portal/');
  const isRegisterRoute = location.pathname.startsWith('/register/') || location.pathname.startsWith('/e/');
  const isBadgeOpenRoute = location.pathname === '/badge';
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformAdminGate, setPlatformAdminGate] = useState<'checking' | 'ok' | 'need_otp'>('checking');
  const sessionUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s?.user?.id) {
        const deactivated = await rejectIfAccountDeactivated(s.user.id);
        if (deactivated) {
          if (!cancelled) {
            sessionUserIdRef.current = null;
            setSession(null);
            setPlatformAdminGate('ok');
            setLoading(false);
          }
          return;
        }
      }
      if (!cancelled) {
        // Hold the OTP gate closed until checkGate finishes — avoids a one-frame
        // flash of the main admin UI after password login.
        if (s?.user?.id) setPlatformAdminGate('checking');
        else setPlatformAdminGate('ok');
        sessionUserIdRef.current = s?.user?.id ?? null;
        setSession(s);
        setLoading(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        clearPlatformAdminEmailOtp();
        clearAwaitingPlatformAdminEmailOtp();
        sessionUserIdRef.current = null;
        setSession(null);
        setPlatformAdminGate('ok');
        return;
      }
      if (!s?.user?.id) {
        sessionUserIdRef.current = null;
        setSession(null);
        setPlatformAdminGate('ok');
        return;
      }

      // Run outside the auth callback so token refreshes cannot keep a
      // deactivated account alive in an already-open cadmin tab.
      setTimeout(() => {
        void (async () => {
          const deactivated = await rejectIfAccountDeactivated(s.user.id);
          if (deactivated) {
            sessionUserIdRef.current = null;
            setSession(null);
            setPlatformAdminGate('ok');
            return;
          }
          // Supabase often re-emits SIGNED_IN when you return to the tab.
          // Only show the full-screen Loading gate for a *new* login.
          // Same-user SIGNED_IN used to set checking without re-running
          // checkGate (user id unchanged) and left the UI stuck forever.
          const sameUser = sessionUserIdRef.current === s.user.id;
          if (!sameUser) {
            setPlatformAdminGate('checking');
          }
          sessionUserIdRef.current = s.user.id;
          setSession((prev) => {
            if (
              sameUser &&
              prev &&
              prev.access_token === s.access_token &&
              prev.refresh_token === s.refresh_token
            ) {
              return prev;
            }
            return s;
          });
        })();
      }, 0);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const sessionUserId = session?.user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    /**
     * @param soft When true (timer / OTP verified), re-validate without
     * swapping the UI to a full-screen "Loading…".
     */
    const checkGate = async (soft = false) => {
      if (!sessionUserId) {
        if (!cancelled) setPlatformAdminGate('ok');
        return;
      }
      if (isPortalRoute || isRegisterRoute || isBadgeOpenRoute) {
        if (!cancelled) setPlatformAdminGate('ok');
        return;
      }

      if (!soft && !cancelled) {
        // While waiting for the email code, never swap to full-screen Loading —
        // that remounted this page and wiped the code-entry form when users
        // switched to email and back.
        if (isAwaitingPlatformAdminEmailOtp()) {
          setPlatformAdminGate('need_otp');
        } else {
          setPlatformAdminGate('checking');
        }
      }

      try {
        const deactivated = await rejectIfAccountDeactivated(sessionUserId);
        if (deactivated) {
          if (!cancelled) {
            sessionUserIdRef.current = null;
            setSession(null);
            setPlatformAdminGate('ok');
          }
          return;
        }
        const access = await userNeedsCadminEmailOtp(sessionUserId);
        // Profile/membership read failures must not skip the email OTP gate.
        if (access.error) {
          if (!cancelled) setPlatformAdminGate('need_otp');
          return;
        }

        if (!access.needsOtp) {
          if (!cancelled) setPlatformAdminGate('ok');
          return;
        }

        const ok = await hasPlatformAdminEmailOtp(sessionUserId);
        if (ok) {
          clearAwaitingPlatformAdminEmailOtp();
          if (!cancelled) setPlatformAdminGate('ok');
          return;
        }

        // Expired verification on a leftover tab: return to password login.
        // Only keep the email-code screen after an intentional password sign-in.
        if (!isAwaitingPlatformAdminEmailOtp()) {
          clearPlatformAdminEmailOtp();
          clearAwaitingPlatformAdminEmailOtp();
          await supabase.auth.signOut();
          if (!cancelled) {
            sessionUserIdRef.current = null;
            setSession(null);
            setPlatformAdminGate('ok');
          }
          return;
        }

        if (!cancelled) setPlatformAdminGate('need_otp');
      } catch {
        // Network / lock contention on tab return must not leave "Loading…" forever,
        // and must not kick users off the email-code screen mid-entry.
        if (!cancelled) {
          setPlatformAdminGate((prev) => {
            if (prev === 'need_otp' || isAwaitingPlatformAdminEmailOtp()) return 'need_otp';
            // Never promote checking → ok on error (would skip email OTP).
            if (prev === 'checking') return 'need_otp';
            return prev;
          });
        }
      }
    };

    void checkGate(false);
    // Soft re-check less often during email OTP entry — tab switching to email
    // was colliding with auth locks and remounting this screen.
    const gateTimer = window.setInterval(() => {
      if (isAwaitingPlatformAdminEmailOtp()) return;
      void checkGate(true);
    }, 60_000);
    const unsub = onPlatformAdminEmailOtpVerified(() => {
      void checkGate(true);
    });
    return () => {
      cancelled = true;
      window.clearInterval(gateTimer);
      unsub();
    };
  }, [sessionUserId, isPortalRoute, isRegisterRoute, isBadgeOpenRoute]);

  if (!isConfigured) {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '40px auto' }}>
        <h1 style={{ color: 'var(--color-danger)' }}>Configuration missing</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> (same as the main app).
        </p>
      </div>
    );
  }

  if (isBadgeOpenRoute) {
    return (
      <>
        <ConnectHostRedirect />
        <Routes>
          <Route path="/badge" element={<BadgeOpen />} />
        </Routes>
      </>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span>Loading…</span>
      </div>
    );
  }

  if (session && platformAdminGate === 'checking' && !isPortalRoute && !isRegisterRoute) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span>Loading…</span>
      </div>
    );
  }

  if (session && platformAdminGate === 'need_otp' && !isPortalRoute && !isRegisterRoute) {
    return (
      <>
        <ConnectHostRedirect />
        <Routes>
          <Route path="/login/email-code" element={<LoginEmailCode />} />
          <Route path="*" element={<Navigate to="/login/email-code" replace />} />
        </Routes>
      </>
    );
  }

  if (isPortalRoute || isRegisterRoute || !session) {
    if (!session && !isPortalRoute && !isRegisterRoute) {
      return (
        <>
          <ConnectHostRedirect />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/login/email-code" element={<Navigate to="/login" replace />} />
            {portalRouteElements()}
            <Route path="/" element={<UnauthenticatedEntry />} />
            <Route path="*" element={<UnauthenticatedEntry />} />
          </Routes>
        </>
      );
    }
    return (
      <>
        <ConnectHostRedirect />
        <Routes>
          {portalRouteElements()}
          {!session ? (
            <>
              <Route path="/" element={<UnauthenticatedEntry />} />
              <Route path="*" element={<UnauthenticatedEntry />} />
            </>
          ) : null}
        </Routes>
      </>
    );
  }

  return (
    <>
      <ConnectHostRedirect />
      <Routes>
        {portalRouteElements()}
        <Route path="/" element={<Layout />}>
          <Route index element={<EventList />} />
          <Route path="troubleshooting" element={<EventTroubleshooting />} />
          <Route path="events/new" element={<EventNew />} />
          <Route path="events/:eventId" element={<EventDetail />} />
          <Route path="events/:eventId/dashboard" element={<Dashboard />} />
          <Route path="events/:eventId/edit" element={<EventEdit />} />
          <Route path="events/:eventId/readiness" element={<EventReadiness />} />
          <Route path="events/:eventId/event-admin-tiles" element={<EventAdminTiles />} />
          <Route path="events/:eventId/schedule" element={<Schedule />} />
          <Route path="events/:eventId/agenda-print" element={<AgendaPrint />} />
          <Route path="events/:eventId/members" element={<Members />} />
          <Route path="events/:eventId/b2b-feedback" element={<B2BFeedback />} />
          <Route path="events/:eventId/session-feedback" element={<SessionFeedback />} />
          <Route path="events/:eventId/meetings" element={<BulkB2BAssign />} />
          <Route path="events/:eventId/bulk-b2b-assign" element={<RedirectBulkB2BToMeetings />} />
          <Route path="events/:eventId/vendor-booths/:boothId" element={<VendorBoothForm />} />
          <Route path="events/:eventId/vendor-booths" element={<VendorBooths />} />
          <Route path="events/:eventId/announcements" element={<Announcements />} />
          <Route path="events/:eventId/photos" element={<EventPhotos />} />
          <Route path="events/:eventId/sponsors" element={<EventSponsors />} />
          <Route path="events/:eventId/matchmaking/:tab?" element={<EventMatchmaking />} />
          <Route
            path="events/:eventId/standard-registration/:tab?"
            element={<EventMatchmaking key="standard" mode="standard" />}
          />
          <Route path="events/:eventId/badges" element={<EventBadges />} />
          <Route path="events/:eventId/scan-log" element={<EventScanLog />} />
          <Route path="events/:eventId/session-attendance" element={<EventSessionAttendance />} />
          <Route path="events/:eventId/session-attendance/:sessionId" element={<EventSessionAttendanceReport />} />
          <Route path="events/:eventId/safety" element={<EventSafety />} />
          <Route path="platform/users" element={<PlatformUsers />} />
          <Route path="platform/audit" element={<PlatformUserAudit />} />
          <Route path="platform/owasp" element={<PlatformOwaspAsvs />} />
          <Route path="platform/test-guide" element={<TestGuide />} />
          <Route path="platform/compute" element={<PlatformSupabaseCompute />} />
          <Route path="platform/health" element={<PlatformHealth />} />
        </Route>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/login/email-code" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
