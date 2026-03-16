import { Routes, Route, Navigate } from 'react-router-dom';
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
import Members from './pages/Members';
import B2BFeedback from './pages/B2BFeedback';
import SessionFeedback from './pages/SessionFeedback';
import Meetings from './pages/Meetings';
import Announcements from './pages/Announcements';
import Dashboard from './pages/Dashboard';

export default function App() {
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span>Loading…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<EventList />} />
        <Route path="events/new" element={<EventNew />} />
        <Route path="events/:eventId" element={<EventDetail />} />
        <Route path="events/:eventId/dashboard" element={<Dashboard />} />
        <Route path="events/:eventId/edit" element={<EventEdit />} />
        <Route path="events/:eventId/schedule" element={<Schedule />} />
        <Route path="events/:eventId/members" element={<Members />} />
        <Route path="events/:eventId/b2b-feedback" element={<B2BFeedback />} />
        <Route path="events/:eventId/session-feedback" element={<SessionFeedback />} />
        <Route path="events/:eventId/meetings" element={<Meetings />} />
        <Route path="events/:eventId/announcements" element={<Announcements />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
