'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabase';

type Event = { id: string; name: string };

export default function WallHome() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from('events')
      .select('id, name')
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .then(({ data }: any) => {
        setEvents(data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#e2e8f0', background: '#1e0a2e', minHeight: '100vh' }}>Loading events…</div>;
  if (!events.length) return <div style={{ padding: 48, textAlign: 'center', color: '#e2e8f0', background: '#1e0a2e', minHeight: '100vh' }}>No active events. Add NEXT_PUBLIC_SUPABASE_* to .env.local.</div>;

  return (
    <div style={{ padding: 48, maxWidth: 800, margin: '0 auto', background: '#1e0a2e', minHeight: '100vh', color: '#fff' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>CollectiveLive Wall</h1>
      <p style={{ color: '#e2e8f0', marginBottom: 32 }}>Select an event for the big screen.</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {events.map((e) => (
          <li key={e.id} style={{ marginBottom: 12 }}>
            <Link
              href={`/wall?event=${e.id}`}
              style={{ display: 'block', padding: 20, background: '#2d1b4e', borderRadius: 12, color: '#fff', textDecoration: 'none', fontSize: 18, border: '1px solid rgba(252,211,77,0.2)' }}
            >
              {e.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
