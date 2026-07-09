import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { uploadEventImage } from '../lib/uploadEventImage';
import { LOGO_FILE_ACCEPT, SPONSOR_LOGO_UPLOAD_HINT } from '../lib/logoUploadHints';
import type { EventSponsorCreative } from '../lib/types';
import {
  allDayDatetimeLocalRange,
  datetimeLocalToUtcIsoWallClock,
  formatCreativeWindowLabel,
  listEventDayKeys,
  utcIsoToDatetimeLocalWallClock,
} from '../lib/sponsorCreativeTime';
import styles from './SponsorCreativesEditor.module.css';

type Props = {
  sponsorId: string;
  eventId: string;
  eventStartDate: string;
  eventEndDate: string;
  eventTimezone: string;
};

type Draft = {
  label: string;
  startsLocal: string;
  endsLocal: string;
};

const emptyDraft = (): Draft => ({
  label: '',
  startsLocal: '',
  endsLocal: '',
});

export default function SponsorCreativesEditor({
  sponsorId,
  eventId,
  eventStartDate,
  eventEndDate,
  eventTimezone,
}: Props) {
  const [rows, setRows] = useState<EventSponsorCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const eventDays = useMemo(
    () => listEventDayKeys(eventStartDate, eventEndDate),
    [eventStartDate, eventEndDate]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const { data, error } = await supabase
        .from('event_sponsor_creatives')
        .select('*')
        .eq('sponsor_id', sponsorId)
        .order('sort_order', { ascending: true })
        .order('starts_at', { ascending: true });
      if (error) throw error;
      setRows((data as EventSponsorCreative[]) ?? []);
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not load scheduled images');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [sponsorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCreative = async (file: File | null) => {
    setErr('');
    if (!file) {
      setErr('Choose an image to upload.');
      return;
    }
    const startsAt = datetimeLocalToUtcIsoWallClock(draft.startsLocal);
    const endsAt = datetimeLocalToUtcIsoWallClock(draft.endsLocal);
    if (!startsAt || !endsAt) {
      setErr('Set a start and end time for this image.');
      return;
    }
    if (endsAt <= startsAt) {
      setErr('End time must be after start time.');
      return;
    }
    setSaving(true);
    try {
      const imageUrl = await uploadEventImage(file, eventId, 'sponsor-logos');
      const { error } = await supabase.from('event_sponsor_creatives').insert({
        sponsor_id: sponsorId,
        event_id: eventId,
        image_url: imageUrl,
        label: draft.label.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        sort_order: rows.length,
      });
      if (error) throw error;
      setDraft(emptyDraft());
      await load();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not add scheduled image');
    } finally {
      setSaving(false);
    }
  };

  const removeCreative = async (id: string) => {
    if (!window.confirm('Remove this scheduled image?')) return;
    setDeletingId(id);
    setErr('');
    try {
      const { error } = await supabase.from('event_sponsor_creatives').delete().eq('id', id);
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not delete');
    } finally {
      setDeletingId(null);
    }
  };

  const applyAllDay = (dayKey: string) => {
    const { startLocal, endLocal } = allDayDatetimeLocalRange(dayKey);
    setDraft((d) => ({ ...d, startsLocal: startLocal, endsLocal: endLocal }));
  };

  const tzLabel = eventTimezone.trim() || 'event timezone';

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Scheduled logo images</h3>
      <p className={styles.hint}>
        Upload extra images and set when each one should appear in the app and live wall. Times use the event
        timezone (<strong>{tzLabel}</strong>). Outside these windows, the default logo above is shown. Overlapping
        windows use the lowest sort order first.
      </p>
      {err ? <p className={styles.error}>{err}</p> : null}

      {loading ? (
        <p className={styles.meta}>Loading scheduled images…</p>
      ) : rows.length === 0 ? (
        <p className={styles.meta}>No scheduled images yet — add one below.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.preview}>
                {row.image_url ? <img src={row.image_url} alt="" /> : null}
              </div>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>{row.label?.trim() || 'Scheduled image'}</div>
                <div className={styles.rowMeta}>{formatCreativeWindowLabel(row.starts_at, row.ends_at)}</div>
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                disabled={deletingId === row.id}
                onClick={() => void removeCreative(row.id)}
              >
                {deletingId === row.id ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.form}>
        <h4 className={styles.formTitle}>Add scheduled image</h4>
        <label className={styles.label}>
          Label (optional)
          <input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Day 2 keynote promo"
          />
        </label>
        <div className={styles.timeRow}>
          <label className={styles.label}>
            Show from ({tzLabel})
            <input
              type="datetime-local"
              value={draft.startsLocal}
              onChange={(e) => setDraft((d) => ({ ...d, startsLocal: e.target.value }))}
            />
          </label>
          <label className={styles.label}>
            Show until ({tzLabel})
            <input
              type="datetime-local"
              value={draft.endsLocal}
              onChange={(e) => setDraft((d) => ({ ...d, endsLocal: e.target.value }))}
            />
          </label>
        </div>
        {eventDays.length > 0 ? (
          <div className={styles.quickDays}>
            <span className={styles.quickLabel}>Quick fill — all day:</span>
            {eventDays.map((dayKey, i) => (
              <button
                key={dayKey}
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => applyAllDay(dayKey)}
              >
                Day {i + 1} ({dayKey})
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.uploadRow}>
          <input
            type="file"
            accept={LOGO_FILE_ACCEPT}
            className={styles.hiddenFile}
            id={`creative-${sponsorId}`}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (f) void addCreative(f);
            }}
          />
          <label htmlFor={`creative-${sponsorId}`}>
            <span className={`${styles.btn} ${styles.btnPrimary}`} style={{ display: 'inline-block' }}>
              {saving ? 'Uploading…' : 'Upload & schedule image'}
            </span>
          </label>
          <p className={styles.meta}>{SPONSOR_LOGO_UPLOAD_HINT}</p>
        </div>
      </div>
    </section>
  );
}

export function formatCreativeAdminPreview(startsAt: string, endsAt: string): string {
  return formatCreativeWindowLabel(startsAt, endsAt);
}

export { utcIsoToDatetimeLocalWallClock };
