import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
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
import TestGuide from './pages/TestGuide';
import EventPhotos from './pages/EventPhotos';
import EventSponsors from './pages/EventSponsors';
import EventMatchmaking from './pages/EventMatchmaking';
import EventBadges from './pages/EventBadges';
import EventScanLog from './pages/EventScanLog';
import EventSessionAttendance from './pages/EventSessionAttendance';
import EventSessionAttendanceReport from './pages/EventSessionAttendanceReport';
import EventSafety from './pages/EventSafety';
import EventAdminTiles from './pages/EventAdminTiles';
import BadgeOpen from './pages/BadgeOpen';
import { portalRouteElements } from './PortalRoutes';
import ConnectHome from './pages/ConnectHome';
import { CADMIN_HOST, CONNECT_HOST, isConnectHost } from './lib/connectHost';

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
      location.pathname === '/login';
    if (isAdminPath) {
      window.location.replace(`https://${CADMIN_HOST}${location.pathname}${location.search}${location.hash}`);
    }
  }, [location]);
  return null;
}

export default function App() {
  const location = useLocation();
  const isPortalRoute = location.pathname.startsWith('/portal/');
  const isRegisterRoute = location.pathname.startsWith('/register/');
  const isBadgeOpenRoute = location.pathname === '/badge';
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (!isConfigured) {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '40px auto' }}>
        <h1 style={{ color: 'var(--color-danger)' }}>Configuration missing</h1>
        <p>Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (same as the main app).</p>
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

  if (isPortalRoute || isRegisterRoute || !session) {
    if (!session && !isPortalRoute && !isRegisterRoute) {
      return (
        <>
          <ConnectHostRedirect />
          <Routes>
            <Route path="/login" element={<Login />} />
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
        <Route path="events/new" element={<EventNew />} />
        <Route path="events/:eventId" element={<EventDetail />} />
        <Route path="events/:eventId/dashboard" element={<Dashboard />} />
        <Route path="events/:eventId/edit" element={<EventEdit />} />
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
        <Route path="events/:eventId/badges" element={<EventBadges />} />
        <Route path="events/:eventId/scan-log" element={<EventScanLog />} />
        <Route path="events/:eventId/session-attendance" element={<EventSessionAttendance />} />
        <Route path="events/:eventId/session-attendance/:sessionId" element={<EventSessionAttendanceReport />} />
        <Route path="events/:eventId/safety" element={<EventSafety />} />
        <Route path="platform/users" element={<PlatformUsers />} />
        <Route path="platform/audit" element={<PlatformUserAudit />} />
        <Route path="platform/test-guide" element={<TestGuide />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
