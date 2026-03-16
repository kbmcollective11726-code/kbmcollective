import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './EventForm.module.css';

const DEFAULT_POINT_RULES = [
  { action: 'post_photo', points_value: 20, max_per_day: null, description: 'Post a photo' },
  { action: 'give_like', points_value: 5, max_per_day: null, description: "Like someone else's post" },
  { action: 'comment', points_value: 10, max_per_day: null, description: "Comment on someone else's post" },
  { action: 'receive_like', points_value: 5, max_per_day: null, description: 'Someone liked your post' },
  { action: 'receive_comment', points_value: 5, max_per_day: null, description: 'Someone commented on your post' },
];

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function EventNew() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState(toYYYYMMDD(new Date()));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return toYYYYMMDD(d);
  });
  const [eventCode, setEventCode] = useState('');
  const [themeColor, setThemeColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [canCreate, setCanCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('users').select('is_platform_admin').eq('id', user.id).single();
      if (!cancelled) setCanCreate((profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setError('Not signed in');
      return;
    }
    const customCode = eventCode.trim() ? eventCode.trim().toUpperCase() : null;
    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          location: location.trim() || null,
          venue: venue.trim() || null,
          start_date: startDate.trim(),
          end_date: endDate.trim(),
          theme_color: themeColor.trim() || '#2563eb',
          event_code: customCode,
          created_by: user.id,
          is_active: true,
        })
        .select()
        .single();
      if (err) throw err;
      const event = data as Event;
      await supabase.from('point_rules').insert(
        DEFAULT_POINT_RULES.map((r) => ({ ...r, event_id: event.id }))
      );
      navigate(`/events/${event.id}`, { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create event';
      if (typeof (e as { code?: string })?.code === 'string' && (e as { code: string }).code === '23505') {
        setError('That event code is already in use. Choose another or leave blank.');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!canCreate) {
    return (
      <div className={styles.page}>
        <p className={styles.error}>Only platform admins can create events. Ask your administrator for access.</p>
        <a href="/">Back to events</a>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1>Create event</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.errorMsg}>{error}</div>}
        <label className={styles.label}>
          Event name *
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={styles.input} placeholder="e.g. Front Office Summit 2025" />
        </label>
        <label className={styles.label}>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={styles.input} rows={2} />
        </label>
        <label className={styles.label}>
          Location
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={styles.input} placeholder="Address or city" />
        </label>
        <label className={styles.label}>
          Venue
          <input type="text" value={venue} onChange={(e) => setVenue(e.target.value)} className={styles.input} placeholder="e.g. Westgate Resort" />
        </label>
        <label className={styles.label}>
          Event code (optional)
          <input type="text" value={eventCode} onChange={(e) => setEventCode(e.target.value)} className={styles.input} placeholder="e.g. SUMMIT26 — leave blank for auto" />
        </label>
        <div className={styles.row}>
          <label className={styles.label}>
            Start date *
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className={styles.input} />
          </label>
          <label className={styles.label}>
            End date *
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required className={styles.input} />
          </label>
        </div>
        <label className={styles.label}>
          Theme color
          <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className={styles.colorInput} />
        </label>
        <div className={styles.actions}>
          <button type="button" onClick={() => navigate(-1)} className={styles.secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={styles.primary}>{saving ? 'Creating…' : 'Create event'}</button>
        </div>
      </form>
    </div>
  );
}
