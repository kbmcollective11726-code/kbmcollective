import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './EventForm.module.css';

export default function EventEdit() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [themeColor, setThemeColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('events')
          .select('*')
          .eq('id', eventId)
          .single();
        if (err) throw err;
        const e = data as Event;
        if (!cancelled) {
          setEvent(e);
          setName(e.name);
          setDescription(e.description ?? '');
          setLocation(e.location ?? '');
          setVenue(e.venue ?? '');
          setStartDate(e.start_date ?? '');
          setEndDate(e.end_date ?? '');
          setEventCode(e.event_code ?? '');
          setThemeColor(e.theme_color ?? '#2563eb');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setError('');
    setSaving(true);
    try {
      const customCode = eventCode.trim() ? eventCode.trim().toUpperCase() : null;
      const { error: err } = await supabase
        .from('events')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          location: location.trim() || null,
          venue: venue.trim() || null,
          start_date: startDate.trim(),
          end_date: endDate.trim(),
          theme_color: themeColor.trim() || '#2563eb',
          event_code: customCode ?? event?.event_code ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventId);
      if (err) throw err;
      navigate(`/events/${eventId}`, { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      if (typeof (e as { code?: string })?.code === 'string' && (e as { code: string }).code === '23505') {
        setError('That event code is already in use.');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error && !event) return <div className={styles.error}>{error}</div>;
  if (!event) return null;

  return (
    <div className={styles.page}>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/events/${eventId}`} style={{ fontSize: 14, color: 'var(--color-accent)' }}>← Back to event</Link>
      </div>
      <h1>Edit event</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.errorMsg}>{error}</div>}
        <label className={styles.label}>
          Event name *
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={styles.input} />
        </label>
        <label className={styles.label}>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={styles.input} rows={2} />
        </label>
        <label className={styles.label}>
          Location
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.label}>
          Venue
          <input type="text" value={venue} onChange={(e) => setVenue(e.target.value)} className={styles.input} />
        </label>
        <label className={styles.label}>
          Event code
          <input type="text" value={eventCode} onChange={(e) => setEventCode(e.target.value)} className={styles.input} />
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
          <button type="submit" disabled={saving} className={styles.primary}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
