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
  websiteUrl: string;
  startsLocal: string;
  endsLocal: string;
};

const emptyDraft = (): Draft => ({
  label: '',
  websiteUrl: '',
  startsLocal: '',
  endsLocal: '',
});

function normalizeWebsiteUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, '')}`;
}

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
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [savingUrlId, setSavingUrlId] = useState<string | null>(null);
  const [timeEdits, setTimeEdits] = useState<Record<string, { startsLocal: string; endsLocal: string }>>({});
  const [savingTimeId, setSavingTimeId] = useState<string | null>(null);

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
      setUrlEdits(
        Object.fromEntries(
          ((data as EventSponsorCreative[]) ?? []).map((row) => [row.id, row.website_url?.trim() || ''])
        )
      );
      setTimeEdits(
        Object.fromEntries(
          ((data as EventSponsorCreative[]) ?? []).map((row) => [
            row.id,
            {
              startsLocal: utcIsoToDatetimeLocalWallClock(row.starts_at),
              endsLocal: utcIsoToDatetimeLocalWallClock(row.ends_at),
            },
          ])
        )
      );
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
        website_url: normalizeWebsiteUrl(draft.websiteUrl),
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

  const saveCreativeUrl = async (id: string) => {
    setSavingUrlId(id);
    setErr('');
    try {
      const { error } = await supabase
        .from('event_sponsor_creatives')
        .update({ website_url: normalizeWebsiteUrl(urlEdits[id] ?? '') })
        .eq('id', id);
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not save link');
    } finally {
      setSavingUrlId(null);
    }
  };

  const saveCreativeSchedule = async (id: string) => {
    const times = timeEdits[id];
    if (!times) return;
    const startsAt = datetimeLocalToUtcIsoWallClock(times.startsLocal);
    const endsAt = datetimeLocalToUtcIsoWallClock(times.endsLocal);
    if (!startsAt || !endsAt) {
      setErr('Set a start and end time for this image.');
      return;
    }
    if (endsAt <= startsAt) {
      setErr('End time must be after start time.');
      return;
    }
    setSavingTimeId(id);
    setErr('');
    try {
      const { error } = await supabase
        .from('event_sponsor_creatives')
        .update({ starts_at: startsAt, ends_at: endsAt })
        .eq('id', id);
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not save schedule');
    } finally {
      setSavingTimeId(null);
    }
  };

  const applyAllDayToRow = (id: string, dayKey: string) => {
    const { startLocal, endLocal } = allDayDatetimeLocalRange(dayKey);
    setTimeEdits((prev) => ({ ...prev, [id]: { startsLocal: startLocal, endsLocal: endLocal } }));
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
        timezone (<strong>{tzLabel}</strong>). Outside these windows, the default logo above is shown. Each
        scheduled image can have its own click link; leave blank to use the sponsor&apos;s default website.
        Overlapping windows use the lowest sort order first.
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
                <div className={styles.timeRow}>
                  <label className={styles.urlLabel}>
                    Show from ({tzLabel})
                    <input
                      type="datetime-local"
                      value={timeEdits[row.id]?.startsLocal ?? ''}
                      onChange={(e) =>
                        setTimeEdits((prev) => ({
                          ...prev,
                          [row.id]: { ...prev[row.id], startsLocal: e.target.value, endsLocal: prev[row.id]?.endsLocal ?? '' },
                        }))
                      }
                    />
                  </label>
                  <label className={styles.urlLabel}>
                    Show until ({tzLabel})
                    <input
                      type="datetime-local"
                      value={timeEdits[row.id]?.endsLocal ?? ''}
                      onChange={(e) =>
                        setTimeEdits((prev) => ({
                          ...prev,
                          [row.id]: { startsLocal: prev[row.id]?.startsLocal ?? '', endsLocal: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
                {eventDays.length > 0 ? (
                  <div className={styles.quickDays}>
                    <span className={styles.quickLabel}>All day:</span>
                    {eventDays.map((dayKey, i) => (
                      <button
                        key={`${row.id}-${dayKey}`}
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() => applyAllDayToRow(row.id, dayKey)}
                      >
                        Day {i + 1}
                      </button>
                    ))}
                  </div>
                ) : null}
                <label className={styles.urlLabel}>
                  Click link (optional)
                  <input
                    value={urlEdits[row.id] ?? ''}
                    onChange={(e) => setUrlEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="https://example.com"
                  />
                </label>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={savingTimeId === row.id}
                  onClick={() => void saveCreativeSchedule(row.id)}
                >
                  {savingTimeId === row.id ? 'Saving…' : 'Save schedule'}
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={savingUrlId === row.id}
                  onClick={() => void saveCreativeUrl(row.id)}
                >
                  {savingUrlId === row.id ? 'Saving…' : 'Save link'}
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={deletingId === row.id}
                  onClick={() => void removeCreative(row.id)}
                >
                  {deletingId === row.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
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
        <label className={styles.label}>
          Click link (optional)
          <input
            value={draft.websiteUrl}
            onChange={(e) => setDraft((d) => ({ ...d, websiteUrl: e.target.value }))}
            placeholder="https://example.com"
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
