import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import { uploadEventImage } from '../lib/uploadEventImage';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { eventFormFieldsFromEvent, eventUpdateRowFromForm, type EventFormFields } from '../lib/eventFormState';
import EventFormBody from '../components/EventFormBody';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import styles from './EventForm.module.css';

export default function EventEdit() {
  const navigate = useNavigate();
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [form, setForm] = useState<EventFormFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [platformAdmin, setPlatformAdmin] = useState(false);

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
          setForm(eventFormFieldsFromEvent(e));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((v) => {
      if (!cancelled) setPlatformAdmin(v);
    });
    return () => { cancelled = true; };
  }, []);

  const persistBanner = useCallback(
    async (banner_url: string | null) => {
      if (!eventId) return;
      const { error: err } = await supabase
        .from('events')
        .update({ banner_url, updated_at: new Date().toISOString() })
        .eq('id', eventId);
      if (err) throw err;
    },
    [eventId]
  );

  const onBannerFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !eventId) return;
    setError('');
    setUploadingBanner(true);
    try {
      const url = await uploadEventImage(file, eventId, 'event-banner');
      setForm((f) => (f ? { ...f, bannerUrl: url } : f));
      await persistBanner(url);
    } catch (err) {
      setError(postgrestErrorMessage(err) || 'Banner upload failed');
    } finally {
      setUploadingBanner(false);
    }
  };

  const onClearBanner = async () => {
    if (!eventId) return;
    setError('');
    try {
      setForm((f) => (f ? { ...f, bannerUrl: '' } : f));
      await persistBanner(null);
    } catch (err) {
      setError(postgrestErrorMessage(err) || 'Failed to remove banner');
    }
  };

  const setFormFields = useCallback((action: React.SetStateAction<EventFormFields>) => {
    setForm((prev) => {
      if (prev === null) return prev;
      return typeof action === 'function' ? action(prev) : action;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !form) return;
    setError('');
    setSaving(true);
    try {
      const row = eventUpdateRowFromForm(form, event?.event_code ?? null, {
        omitMenuLiveWall: !platformAdmin,
        omitMenuShowNotes: !Object.prototype.hasOwnProperty.call(event as object, 'menu_show_notes'),
      });
      const updatedAt = new Date().toISOString();
      let { error: err } = await supabase
        .from('events')
        .update({
          ...row,
          updated_at: updatedAt,
        })
        .eq('id', eventId);
      if (err) {
        const hint = postgrestErrorMessage(err);
        if (/menu_show_notes|schema cache|Could not find.*menu_show_notes/i.test(hint)) {
          const { menu_show_notes: _n, ...rest } = row as Record<string, unknown>;
          const retry = await supabase.from('events').update({ ...rest, updated_at: updatedAt }).eq('id', eventId);
          err = retry.error;
        }
      }
      if (err) throw err;
      navigate(`/events/${eventId}`, { replace: true });
    } catch (e) {
      const msg = postgrestErrorMessage(e) || 'Failed to update';
      const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === '23505' || msg.includes('23505')) {
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
  if (!event || !form) return null;

  return (
    <div className={styles.page}>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/events/${eventId}`} style={{ fontSize: 14, color: 'var(--color-accent)' }}>← Back to event</Link>
      </div>
      <h1>Edit event</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.errorMsg}>{error}</div>}
        <EventFormBody
          form={form}
          setForm={setFormFields}
          canEditLiveWallMenu={platformAdmin}
          bannerUpload={{
            uploadingBanner,
            onBannerFile,
            onClearBanner,
            bannerPreviewSrc: form.bannerUrl,
          }}
        />
        <div className={styles.actions}>
          <button type="button" onClick={() => navigate(-1)} className={styles.secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={styles.primary}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
