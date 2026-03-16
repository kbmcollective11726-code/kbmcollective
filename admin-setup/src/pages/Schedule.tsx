import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ScheduleSession } from '../lib/types';
import type { Event } from '../lib/types';
import styles from './Schedule.module.css';

const CSV_HEADERS = ['title', 'description', 'speaker_name', 'speaker_title', 'speaker_company', 'location', 'room', 'start_date', 'start_time', 'end_date', 'end_time', 'session_type'] as const;
const SESSION_TYPES = ['keynote', 'breakout', 'workshop', 'social', 'meal', 'networking', 'vendor'] as const;

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      out.push(val);
    } else {
      const comma = line.indexOf(',', i);
      const end = comma === -1 ? line.length : comma;
      out.push(line.slice(i, end).trim());
      i = comma === -1 ? line.length : comma + 1;
    }
  }
  return out;
}

function getDayNumber(startTime: Date, eventStartDate: string): number {
  const startKey = eventStartDate.slice(0, 10);
  if (!startKey || startKey.length < 10) return 1;
  const start = new Date(startKey + 'T00:00:00');
  const diffMs = startTime.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays + 1);
}

export default function Schedule() {
  const { eventId } = useParams<{ eventId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; failed: number; errors: string[] } | null>(null);
  const [editingSession, setEditingSession] = useState<ScheduleSession | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', speaker_name: '', location: '', room: '', start_time: '', end_time: '', session_type: 'breakout' });
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name, start_date').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: sessionsData, error } = await supabase
          .from('schedule_sessions')
          .select('id, title, description, speaker_name, location, room, start_time, end_time, day_number, session_type')
          .eq('event_id', eventId)
          .order('day_number')
          .order('start_time');
        if (error) throw error;
        if (!cancelled) setSessions((sessionsData as ScheduleSession[]) ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !eventId || !event) return;
    e.target.value = '';
    setImportResult(null);
    setImporting(true);
    const errors: string[] = [];
    let added = 0;
    let failed = 0;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setImportResult({ added: 0, failed: 0, errors: ['CSV must have a header row and at least one data row.'] });
        setImporting(false);
        return;
      }
      const eventStart = event.start_date ?? '';

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvRow(lines[i] ?? '');
        const row: Record<string, string> = {};
        CSV_HEADERS.forEach((h, idx) => {
          row[h] = (values[idx] ?? '').trim();
        });
        if (!row.title) {
          failed++;
          errors.push(`Row ${i + 1}: title is required`);
          continue;
        }
        const startDateStr = row.start_date || eventStart;
        const startTimeStr = row.start_time || '09:00';
        const endDateStr = row.end_date || startDateStr;
        const endTimeStr = row.end_time || '10:00';
        const [sy, sm, sd] = startDateStr.split('-').map((x) => parseInt(x, 10) || 0);
        const [sth, stm] = startTimeStr.split(':').map((x) => parseInt(x, 10) || 0);
        const [ey, em, ed] = endDateStr.split('-').map((x) => parseInt(x, 10) || 0);
        const [eth, etm] = endTimeStr.split(':').map((x) => parseInt(x, 10) || 0);
        const startDate = new Date(sy || new Date().getFullYear(), (sm || 1) - 1, sd || 1, sth || 9, stm || 0, 0, 0);
        const endDate = new Date(ey || new Date().getFullYear(), (em || 1) - 1, ed || 1, eth || 10, etm || 0, 0, 0);
        const sessionType = (row.session_type || 'breakout').toLowerCase();
        const validType = SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number]) ? sessionType : 'breakout';
        const speakerName = row.speaker_name || null;
        const speakerTitle = row.speaker_title || null;
        const payload = {
          event_id: eventId,
          title: row.title,
          description: row.description || null,
          speaker_name: speakerName,
          speaker_title: speakerTitle,
          location: row.location || null,
          room: row.room || null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          day_number: getDayNumber(startDate, eventStart),
          session_type: validType,
          is_active: true,
        };
        const { error } = await supabase.from('schedule_sessions').insert(payload);
        if (error) {
          failed++;
          errors.push(`Row ${i + 1}: ${error.message}`);
        } else {
          added++;
        }
      }
      setImportResult({ added, failed, errors: errors.slice(0, 20) });
      if (added > 0) {
        const { data } = await supabase
          .from('schedule_sessions')
          .select('id, title, description, speaker_name, location, room, start_time, end_time, day_number, session_type')
          .eq('event_id', eventId)
          .order('day_number')
          .order('start_time');
        setSessions((data as ScheduleSession[]) ?? []);
      }
    } catch (err) {
      setImportResult({
        added: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : 'Failed to parse CSV'],
      });
    } finally {
      setImporting(false);
    }
  };

  const toDateTimeLocal = (iso: string) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  const openEdit = (s: ScheduleSession) => {
    setEditingSession(s);
    setEditForm({
      title: s.title,
      description: s.description ?? '',
      speaker_name: s.speaker_name ?? '',
      location: s.location ?? '',
      room: s.room ?? '',
      start_time: toDateTimeLocal(s.start_time),
      end_time: toDateTimeLocal(s.end_time),
      session_type: s.session_type ?? 'breakout',
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession || !eventId || !event) return;
    setSavingEdit(true);
    try {
      const startDate = new Date(editForm.start_time);
      const endDate = new Date(editForm.end_time);
      const dayNumber = getDayNumber(startDate, event.start_date ?? '');
      const { error } = await supabase
        .from('schedule_sessions')
        .update({
          title: editForm.title.trim(),
          description: editForm.description.trim() || null,
          speaker_name: editForm.speaker_name.trim() || null,
          location: editForm.location.trim() || null,
          room: editForm.room.trim() || null,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          day_number: dayNumber,
          session_type: SESSION_TYPES.includes(editForm.session_type as (typeof SESSION_TYPES)[number]) ? editForm.session_type : 'breakout',
        })
        .eq('id', editingSession.id);
      if (error) throw error;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === editingSession.id
            ? {
                ...s,
                title: editForm.title.trim(),
                description: editForm.description.trim() || null,
                speaker_name: editForm.speaker_name.trim() || null,
                location: editForm.location.trim() || null,
                room: editForm.room.trim() || null,
                start_time: startDate.toISOString(),
                end_time: endDate.toISOString(),
                day_number: dayNumber,
                session_type: editForm.session_type,
              }
            : s
        )
      );
      setEditingSession(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteSession = async (s: ScheduleSession) => {
    if (!eventId || !confirm(`Delete session "${s.title}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('schedule_sessions').delete().eq('id', s.id);
      if (error) throw error;
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Schedule — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        Import a CSV with columns: {CSV_HEADERS.join(', ')}. One row per session. Dates as YYYY-MM-DD, times as HH:MM (24h).
      </p>
      <div className={styles.toolbar}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          disabled={importing}
          className={styles.importBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? 'Importing…' : 'Import CSV (batch)'}
        </button>
        <button
          type="button"
          className={styles.templateBtn}
          onClick={() => {
            const eventStart = event?.start_date ?? new Date().toISOString().slice(0, 10);
            const row = [
              'Opening Keynote',
              'Welcome session',
              'Speaker Name',
              'CEO',
              'Company Inc',
              'Main Hall',
              '101',
              eventStart,
              '09:00',
              eventStart,
              '10:00',
              'keynote',
            ].join(',');
            const csv = [CSV_HEADERS.join(','), row].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'session-template.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download template
        </button>
      </div>
      {importResult && (
        <div className={styles.result}>
          <strong>Import result:</strong> {importResult.added} added, {importResult.failed} failed.
          {importResult.errors.length > 0 && (
            <ul className={styles.errorList}>
              {importResult.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {importResult.errors.length >= 20 && <li>…and more</li>}
            </ul>
          )}
        </div>
      )}
      <h2 className={styles.listTitle}>Sessions ({sessions.length})</h2>
      {sessions.length === 0 ? (
        <p className={styles.empty}>No sessions yet. Import a CSV or add them in the mobile app.</p>
      ) : (
        <ul className={styles.list}>
          {sessions.map((s) => (
            <li key={s.id} className={styles.item}>
              <span className={styles.itemTitle}>{s.title}</span>
              <span className={styles.itemMeta}>
                Day {s.day_number} · {s.start_time.slice(11, 16)} – {s.end_time.slice(11, 16)}
                {s.speaker_name ? ` · ${s.speaker_name}` : ''}
                {s.location ? ` · ${s.location}` : ''}
              </span>
              <div className={styles.itemActions}>
                <button type="button" className={`${styles.itemBtn} ${styles.itemBtnEdit}`} onClick={() => openEdit(s)}>
                  Edit
                </button>
                <button type="button" className={`${styles.itemBtn} ${styles.itemBtnDanger}`} onClick={() => handleDeleteSession(s)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingSession && (
        <div className={styles.modalOverlay} onClick={() => setEditingSession(null)} role="dialog" aria-modal="true">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Edit session</h2>
              <button type="button" className={styles.modalClose} onClick={() => setEditingSession(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className={styles.modalBody}>
              <label>Title</label>
              <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} required />
              <label>Description</label>
              <input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
              <label>Speaker name</label>
              <input value={editForm.speaker_name} onChange={(e) => setEditForm((f) => ({ ...f, speaker_name: e.target.value }))} />
              <label>Location / Room</label>
              <input value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} placeholder="Location" />
              <input value={editForm.room} onChange={(e) => setEditForm((f) => ({ ...f, room: e.target.value }))} placeholder="Room" />
              <label>Start (date & time)</label>
              <input type="datetime-local" value={editForm.start_time} onChange={(e) => setEditForm((f) => ({ ...f, start_time: e.target.value }))} required />
              <label>End (date & time)</label>
              <input type="datetime-local" value={editForm.end_time} onChange={(e) => setEditForm((f) => ({ ...f, end_time: e.target.value }))} required />
              <label>Type</label>
              <select value={editForm.session_type} onChange={(e) => setEditForm((f) => ({ ...f, session_type: e.target.value }))}>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button type="submit" className={styles.importBtn} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
