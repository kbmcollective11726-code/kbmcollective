import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import { uploadEventImage } from '../lib/uploadEventImage';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import {
  defaultEventFormFields,
  eventInsertRowFromForm,
  toYYYYMMDD,
  type EventFormFields,
} from '../lib/eventFormState';
import EventFormBody from '../components/EventFormBody';
import styles from './EventForm.module.css';

const DEFAULT_POINT_RULES = [
  { action: 'post_photo', points_value: 20, max_per_day: null, description: 'Post a photo' },
  { action: 'give_like', points_value: 5, max_per_day: null, description: "Like someone else's post" },
  { action: 'comment', points_value: 10, max_per_day: null, description: "Comment on someone else's post" },
  { action: 'receive_like', points_value: 5, max_per_day: null, description: 'Someone liked your post' },
  { action: 'receive_comment', points_value: 5, max_per_day: null, description: 'Someone commented on your post' },
];

export default function EventNew() {
  const navigate = useNavigate();
  const [form, setForm] = useState<EventFormFields>(() => {
    const end = new Date();
    end.setDate(end.getDate() + 3);
    return defaultEventFormFields(toYYYYMMDD(new Date()), toYYYYMMDD(end));
  });
  const [pendingBannerFile, setPendingBannerFile] = useState<File | null>(null);
  const [bannerObjectUrl, setBannerObjectUrl] = useState<string | null>(null);
  const [uploadingBannerAfterCreate, setUploadingBannerAfterCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [canCreate, setCanCreate] = useState(false);

  useEffect(() => {
    if (!pendingBannerFile) {
      setBannerObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingBannerFile);
    setBannerObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pendingBannerFile]);

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

  const onBannerFile = useCallback((ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setPendingBannerFile(file);
  }, []);

  const onClearBanner = useCallback(() => {
    setPendingBannerFile(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setError('Not signed in');
      return;
    }
    setSaving(true);
    try {
      const row = eventInsertRowFromForm(form) as Record<string, unknown>;
      const baseInsert = { ...row, created_by: user.id, is_active: true as const };
      let { data, error: err } = await supabase.from('events').insert(baseInsert).select().single();
      if (err) {
        const hint = postgrestErrorMessage(err);
        if (/menu_show_notes|schema cache|Could not find.*menu_show_notes/i.test(hint)) {
          const { menu_show_notes: _m, ...rest } = row;
          const retry = await supabase
            .from('events')
            .insert({ ...rest, created_by: user.id, is_active: true })
            .select()
            .single();
          data = retry.data;
          err = retry.error;
        }
      }
      if (err) throw err;
      const event = data as Event;

      if (pendingBannerFile) {
        setUploadingBannerAfterCreate(true);
        try {
          const url = await uploadEventImage(pendingBannerFile, event.id, 'event-banner');
          const { error: upErr } = await supabase
            .from('events')
            .update({ banner_url: url, updated_at: new Date().toISOString() })
            .eq('id', event.id);
          if (upErr) throw upErr;
        } catch (bannerErr) {
          setError(
            `Event was created, but the banner failed to upload: ${postgrestErrorMessage(bannerErr) || (bannerErr instanceof Error ? bannerErr.message : 'Unknown error')}. Open Edit event to try again.`
          );
          await supabase.from('point_rules').insert(
            DEFAULT_POINT_RULES.map((r) => ({ ...r, event_id: event.id }))
          );
          navigate(`/events/${event.id}/edit`, { replace: true });
          return;
        } finally {
          setUploadingBannerAfterCreate(false);
        }
      }

      await supabase.from('point_rules').insert(
        DEFAULT_POINT_RULES.map((r) => ({ ...r, event_id: event.id }))
      );
      navigate(`/events/${event.id}`, { replace: true });
    } catch (e) {
      const msg = postgrestErrorMessage(e) || 'Failed to create event';
      const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === '23505' || msg.includes('23505')) {
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

  const bannerPreviewSrc = bannerObjectUrl ?? form.bannerUrl;

  return (
    <div className={styles.page}>
      <h1>Create event</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <div className={styles.errorMsg}>{error}</div>}
        <EventFormBody
          form={form}
          setForm={setForm}
          bannerUpload={{
            uploadingBanner: uploadingBannerAfterCreate || saving,
            onBannerFile,
            onClearBanner,
            bannerPreviewSrc,
          }}
        />
        <div className={styles.actions}>
          <button type="button" onClick={() => navigate(-1)} className={styles.secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={styles.primary}>
            {saving ? (pendingBannerFile ? 'Creating & uploading…' : 'Creating…') : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  );
}
