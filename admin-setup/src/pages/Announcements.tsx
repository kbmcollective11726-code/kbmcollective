import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './Announcements.module.css';

type TargetType = 'all' | 'audience' | 'specific';
type AudienceRole = 'attendee' | 'speaker' | 'vendor';

type EventMemberOption = { user_id: string; full_name: string; role: string };

type AnnouncementRow = {
  id: string;
  event_id: string;
  title: string;
  content: string;
  priority: string;
  send_push: boolean;
  created_at: string;
  scheduled_at: string | null;
  sent_at: string | null;
  target_type: string | null;
};

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

export default function Announcements() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [list, setList] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [sendPush, setSendPush] = useState(true);
  const [targetType, setTargetType] = useState<TargetType>('all');
  const [audienceRoles, setAudienceRoles] = useState<AudienceRole[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledLocal, setScheduledLocal] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [memberOptions, setMemberOptions] = useState<EventMemberOption[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadList = useCallback(async () => {
    if (!eventId) return;
    const { data: rows, error: err } = await supabase
      .from('announcements')
      .select('id, event_id, title, content, priority, send_push, created_at, scheduled_at, sent_at, target_type')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) throw err;
    setList((rows as AnnouncementRow[]) ?? []);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        await loadList();
      } catch {
        if (!cancelled) setList([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, loadList]);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const { data } = await supabase
        .from('event_members')
        .select('user_id, role, users!inner(full_name)')
        .eq('event_id', eventId)
        .neq('role', 'super_admin');
      if (data) {
        setMemberOptions(
          (data as unknown as { user_id: string; role: string; users: { full_name: string } }[]).map((r) => ({
            user_id: r.user_id,
            full_name:
              r.users && typeof r.users === 'object' && 'full_name' in r.users
                ? (r.users as { full_name: string }).full_name
                : 'Unknown',
            role: r.role,
          }))
        );
      }
    })();
  }, [eventId]);

  const toggleAudienceRole = (role: AudienceRole) => {
    setAudienceRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const getRecipientIds = async (): Promise<string[]> => {
    if (!eventId) return [];
    if (targetType === 'all') {
      const { data } = await supabase.from('event_members').select('user_id').eq('event_id', eventId);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
    if (targetType === 'audience' && audienceRoles.length > 0) {
      const { data } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', eventId)
        .in('role', audienceRoles);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
    if (targetType === 'specific' && selectedUserIds.length > 0) {
      return selectedUserIds;
    }
    return [];
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess('');
    if (!eventId || !title.trim() || !content.trim()) {
      setError('Title and message are required.');
      return;
    }
    if (targetType === 'audience' && audienceRoles.length === 0) {
      setError('Select at least one audience type (attendee, speaker, vendor).');
      return;
    }
    if (targetType === 'specific' && selectedUserIds.length === 0) {
      setError('Select at least one person.');
      return;
    }

    const scheduledDate = new Date(scheduledLocal);
    if (!scheduleNow && scheduledDate <= new Date()) {
      setError('Scheduled time must be in the future.');
      return;
    }

    setError('');
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('Not signed in');

      const basePayload = {
        event_id: eventId,
        title: title.trim(),
        content: content.trim(),
        priority: priority || 'normal',
        send_push: scheduleNow ? sendPush : false,
        sent_by: session.user.id,
      };

      if (scheduleNow) {
        const { error: insertErr } = await supabase.from('announcements').insert(basePayload);
        if (insertErr) throw insertErr;

        const recipientIds = await getRecipientIds();
        for (const uid of recipientIds) {
          await supabase.from('notifications').insert({
            user_id: uid,
            event_id: eventId,
            type: 'announcement',
            title: title.trim(),
            body: content.trim(),
            data: {},
          });
        }
        if (sendPush && recipientIds.length > 0 && session.access_token) {
          const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              event_id: eventId,
              title: title.trim(),
              body: content.trim(),
              recipient_user_ids: recipientIds,
            }),
          });
          if (!pushRes.ok) {
            const t = await pushRes.text();
            console.warn('Push send warning:', t);
          }
        }
        setSuccess(
          `Sent to ${recipientIds.length} recipient(s)${sendPush ? ' (push requested where users have tokens).' : '.'}`
        );
      } else {
        const scheduledAt = scheduledDate.toISOString();
        const { error: insertErr } = await supabase.from('announcements').insert({
          ...basePayload,
          scheduled_at: scheduledAt,
          target_type: targetType,
          target_audience: targetType === 'audience' ? audienceRoles : null,
          target_user_ids: targetType === 'specific' ? selectedUserIds : null,
        });
        if (insertErr) {
          const columnMissing =
            /column .* does not exist/i.test(insertErr.message) ||
            /could not find.*scheduled_at/i.test(insertErr.message);
          if (columnMissing) {
            setError(
              'Scheduling needs DB columns. In Supabase SQL Editor run: scripts/migrate-announcements-targeting.sql — then deploy cron + process-scheduled-announcements (see ANNOUNCEMENTS-SETUP.md).'
            );
            setSending(false);
            return;
          }
          throw insertErr;
        }
        setSuccess(
          `Scheduled for ${scheduledDate.toLocaleString()}. Ensure process-scheduled-announcements + cron are set up (ANNOUNCEMENTS-SETUP.md).`
        );
      }

      setTitle('');
      setContent('');
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Announcements — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        Match the mobile app: choose who receives it, send now or schedule. Scheduled sends require the backend job in
        ANNOUNCEMENTS-SETUP.md.
      </p>

      <form onSubmit={handleSend} className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <label className={styles.label}>Title</label>
        <input
          type="text"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title"
          required
        />

        <label className={styles.label}>Message</label>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Message content..."
          required
        />

        <label className={styles.label}>Priority</label>
        <select className={styles.select} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>

        <label className={styles.label}>Send to</label>
        <div className={styles.chipRow}>
          {(['all', 'audience', 'specific'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.chip} ${targetType === t ? styles.chipActive : ''}`}
              onClick={() => setTargetType(t)}
            >
              {t === 'all' ? 'All' : t === 'audience' ? 'By role' : 'Specific'}
            </button>
          ))}
        </div>

        {targetType === 'audience' && (
          <div className={styles.chipRow}>
            {(['attendee', 'speaker', 'vendor'] as AudienceRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className={`${styles.chip} ${styles.chipSm} ${audienceRoles.includes(role) ? styles.chipActive : ''}`}
                onClick={() => toggleAudienceRole(role)}
              >
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </button>
            ))}
          </div>
        )}

        {targetType === 'specific' && (
          <div className={styles.userList}>
            {memberOptions.slice(0, 50).map((m) => (
              <button
                key={m.user_id}
                type="button"
                className={`${styles.userRow} ${selectedUserIds.includes(m.user_id) ? styles.userRowSelected : ''}`}
                onClick={() => toggleUserSelection(m.user_id)}
              >
                <span className={styles.userName}>{m.full_name}</span>
                <span className={styles.userRole}>{m.role}</span>
              </button>
            ))}
            {memberOptions.length > 50 && <p className={styles.listHint}>Showing first 50 members</p>}
          </div>
        )}

        <label className={styles.label}>Schedule</label>
        <div className={styles.chipRow}>
          <button
            type="button"
            className={`${styles.chip} ${scheduleNow ? styles.chipActive : ''}`}
            onClick={() => setScheduleNow(true)}
          >
            Send now
          </button>
          <button
            type="button"
            className={`${styles.chip} ${!scheduleNow ? styles.chipActive : ''}`}
            onClick={() => setScheduleNow(false)}
          >
            Schedule
          </button>
        </div>

        {!scheduleNow && (
          <>
            <label className={styles.label}>Send at (local time)</label>
            <input
              type="datetime-local"
              className={styles.input}
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
          </>
        )}

        {scheduleNow && (
          <div className={styles.checkboxRow}>
            <input type="checkbox" id="sendPush" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
            <label htmlFor="sendPush">Send push notifications to recipients (with tokens)</label>
          </div>
        )}

        <button type="submit" className={styles.btn} disabled={sending}>
          {sending ? 'Working…' : scheduleNow ? 'Send announcement' : 'Schedule announcement'}
        </button>
      </form>

      <h2 className={styles.listTitle}>Recent announcements ({list.length})</h2>
      {list.length === 0 ? (
        <p className={styles.empty}>No announcements yet.</p>
      ) : (
        <ul className={styles.list}>
          {list.map((a) => (
            <li key={a.id} className={styles.item}>
              <span className={styles.itemTitle}>{a.title}</span>
              <span className={styles.itemMeta}>
                {new Date(a.created_at).toLocaleString()} · {a.priority}
                {a.scheduled_at && !a.sent_at && (
                  <> · Scheduled {new Date(a.scheduled_at).toLocaleString()}</>
                )}
                {a.sent_at && <> · Sent {new Date(a.sent_at).toLocaleString()}</>}
                {!a.scheduled_at && a.send_push && <> · Push</>}
                {a.target_type && a.target_type !== 'all' && <> · To: {a.target_type}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
