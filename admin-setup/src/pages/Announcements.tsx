import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './Announcements.module.css';

type AnnouncementRow = {
  id: string;
  event_id: string;
  title: string;
  content: string;
  priority: string;
  send_push: boolean;
  created_at: string;
};

export default function Announcements() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [list, setList] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [sendPush, setSendPush] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: rows, error: err } = await supabase
          .from('announcements')
          .select('id, event_id, title, content, priority, send_push, created_at')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (err) throw err;
        if (!cancelled) setList((rows as AnnouncementRow[]) ?? []);
      } catch {
        if (!cancelled) setList([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !title.trim() || !content.trim()) {
      setError('Title and message are required.');
      return;
    }
    setError('');
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('Not signed in');
      const { error: insertErr } = await supabase
        .from('announcements')
        .insert({
          event_id: eventId,
          title: title.trim(),
          content: content.trim(),
          priority: priority || 'normal',
          send_push: sendPush,
          sent_by: session.user.id,
        });
      if (insertErr) throw insertErr;
      const { data: members } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', eventId);
      const recipientIds = (members ?? []).map((r: { user_id: string }) => r.user_id);
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
        await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            event_id: eventId,
            title: title.trim(),
            body: content.trim(),
            recipient_user_ids: recipientIds,
          }),
        });
      }
      setTitle('');
      setContent('');
      const { data: rows } = await supabase
        .from('announcements')
        .select('id, event_id, title, content, priority, send_push, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(50);
      setList((rows as AnnouncementRow[]) ?? []);
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
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Announcements — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>Create an announcement. All event members receive it in-app; optionally send push notifications.</p>

      <form onSubmit={handleSend} className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}
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
        <div className={styles.checkboxRow}>
          <input type="checkbox" id="sendPush" checked={sendPush} onChange={(e) => setSendPush(e.target.checked)} />
          <label htmlFor="sendPush">Send push notifications to all event members</label>
        </div>
        <button type="submit" className={styles.btn} disabled={sending}>
          {sending ? 'Sending…' : 'Send announcement'}
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
                {a.send_push ? ' · Push sent' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
