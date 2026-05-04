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

  const pageShell = {
    padding: 48,
    maxWidth: 800,
    margin: '0 auto',
    minHeight: '100vh',
    color: '#f8f9fa',
  } as const;

  if (loading)
    return (
      <div style={{ ...pageShell, textAlign: 'center', color: 'rgba(248,249,250,0.72)' }}>Loading events…</div>
    );
  if (!events.length)
    return (
      <div style={{ ...pageShell, textAlign: 'center', color: 'rgba(248,249,250,0.72)' }}>
        No active events. Add NEXT_PUBLIC_SUPABASE_* to .env.local.
      </div>
    );

  return (
    <div style={pageShell}>
      <div style={{ width: 36, height: 4, background: '#c9a961', borderRadius: 2, marginBottom: 16 }} aria-hidden />
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>KBM Connect Wall</h1>
      <p style={{ color: 'rgba(248,249,250,0.72)', marginBottom: 32, fontSize: 15, letterSpacing: '0.02em' }}>
        Select an event for the big screen.
      </p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {events.map((e) => (
          <li key={e.id} style={{ marginBottom: 12 }}>
            <Link
              href={`/wall?event=${e.id}`}
              style={{
                display: 'block',
                padding: '18px 22px',
                background: '#2d3e50',
                borderRadius: 12,
                color: '#f8f9fa',
                textDecoration: 'none',
                fontSize: 17,
                fontWeight: 600,
                border: '1px solid rgba(201, 169, 97, 0.35)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}
            >
              {e.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
