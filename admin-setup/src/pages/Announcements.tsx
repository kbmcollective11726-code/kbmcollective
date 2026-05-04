import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl, edgeFunctionHeaders } from '../lib/supabase';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import type { Event } from '../lib/types';
import styles from './Announcements.module.css';

type TargetType = 'all' | 'audience' | 'specific';
type AudienceRole = 'attendee' | 'speaker' | 'vendor';

type EventMemberOption = { user_id: string; full_name: string; role: string; roles: string[] };

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
  const [userSearch, setUserSearch] = useState('');
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
          (
            data as unknown as { user_id: string; role: string; roles?: string[] | null; users: { full_name: string } }[]
          ).map((r) => ({
            user_id: r.user_id,
            full_name:
              r.users && typeof r.users === 'object' && 'full_name' in r.users
                ? (r.users as { full_name: string }).full_name
                : 'Unknown',
            role: r.role,
            roles: Array.isArray(r.roles) && r.roles.length > 0 ? r.roles : [r.role],
          }))
        );
      }
    })();
  }, [eventId]);

  const filteredMembers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return memberOptions;
    return memberOptions.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [memberOptions, userSearch]);

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
      return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
    }
    if (targetType === 'audience' && audienceRoles.length > 0) {
      const selected = new Set(audienceRoles);
      const ids = memberOptions
        .filter((m) => m.roles.some((role) => selected.has(role as AudienceRole)))
        .map((m) => m.user_id);
      return [...new Set(ids)];
    }
    if (targetType === 'specific' && selectedUserIds.length > 0) {
      return [...new Set(selectedUserIds)];
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
      await refreshSupabaseSessionIfNeeded();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('Not signed in');

      const targetMeta = {
        target_type: targetType,
        target_audience: targetType === 'audience' ? audienceRoles : null,
        target_user_ids: targetType === 'specific' ? selectedUserIds : null,
      } as const;

      const basePayload = {
        event_id: eventId,
        title: title.trim(),
        content: content.trim(),
        priority: priority || 'normal',
        send_push: scheduleNow ? sendPush : false,
        sent_by: session.user.id,
        ...targetMeta,
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
        let pushNote = '';
        if (sendPush && recipientIds.length > 0 && session.access_token) {
          const pushBody = {
            event_id: eventId,
            title: title.trim(),
            body: content.trim(),
            recipient_user_ids: recipientIds,
          };
          let activeToken = session.access_token;
          let pushRes = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
            method: 'POST',
            headers: edgeFunctionHeaders(activeToken),
            body: JSON.stringify(pushBody),
          });
          // Access token may expire while admin page is open; refresh once and retry.
          if (pushRes.status === 401) {
            await supabase.auth.refreshSession();
            const { data: refreshed } = await supabase.auth.getSession();
            if (refreshed.session?.access_token) {
              activeToken = refreshed.session.access_token;
              pushRes = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
                method: 'POST',
                headers: edgeFunctionHeaders(activeToken),
                body: JSON.stringify(pushBody),
              });
            }
          }

          const pushText = await pushRes.text();
          let pushData: { sent?: number; error?: string; message?: string; ticket_errors?: string[] } = {};
          try {
            pushData = pushText ? (JSON.parse(pushText) as typeof pushData) : {};
          } catch {
            /* non-JSON error body */
          }
          if (!pushRes.ok) {
            pushNote = ` Device push failed (${pushRes.status}): ${pushData.error || pushText.slice(0, 180)}`;
            console.warn('Push send warning:', pushText);
          } else {
            const n = pushData.sent ?? 0;
            if (n === 0) {
              pushNote = ` No device push — ${pushData.message || 'no Expo push tokens for these users (open the app on a store/EAS build, allow notifications; check users.push_token in Supabase).'}`;
            } else {
              pushNote = ` Device push OK for ${n} token(s).`;
              if (pushData.ticket_errors?.length) {
                pushNote += ` Expo: ${pushData.ticket_errors.slice(0, 2).join('; ')}`;
              }
            }
          }
        } else if (sendPush && recipientIds.length > 0 && !session.access_token) {
          pushNote = ' Device push skipped (no access token — refresh the page and sign in again).';
        }
        setSuccess(
          `In-app notification to ${recipientIds.length} recipient(s).${sendPush ? pushNote : ''}`
        );
      } else {
        const scheduledAt = scheduledDate.toISOString();
        const { error: insertErr } = await supabase.from('announcements').insert({
          ...basePayload,
          scheduled_at: scheduledAt,
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
              onClick={() => {
                setTargetType(t);
                if (t !== 'specific') setUserSearch('');
              }}
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
          <div className={styles.specificWrap}>
            <label className={styles.srOnly} htmlFor="announcement-user-search">
              Search members
            </label>
            <input
              id="announcement-user-search"
              type="search"
              className={styles.searchInput}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name or role…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className={styles.listHint}>
              {filteredMembers.length === memberOptions.length
                ? `${memberOptions.length} member${memberOptions.length === 1 ? '' : 's'}`
                : `${filteredMembers.length} of ${memberOptions.length} shown`}
              {selectedUserIds.length > 0 ? ` · ${selectedUserIds.length} selected` : ''}
            </p>
            <div className={styles.userList}>
              {filteredMembers.map((m) => (
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
              {filteredMembers.length === 0 && memberOptions.length > 0 && (
                <p className={styles.searchEmpty}>No members match your search.</p>
              )}
              {memberOptions.length === 0 && (
                <p className={styles.searchEmpty}>No members loaded for this event.</p>
              )}
            </div>
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
