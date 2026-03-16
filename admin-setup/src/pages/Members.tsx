import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl } from '../lib/supabase';
import type { Event } from '../lib/types';
import styles from './Members.module.css';

type MemberRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
};

const ROLES = ['attendee', 'speaker', 'vendor', 'admin'] as const;

function parseCsvLine(line: string): string[] {
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

export default function Members() {
  const { eventId } = useParams<{ eventId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; notFound: string[] } | null>(null);
  const [bulkPassword, setBulkPassword] = useState('');
  const [bulkRole, setBulkRole] = useState<string>('attendee');
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; failed: number; errors: string[] } | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!eventId) return;
    const role = ROLES.includes(newRole as (typeof ROLES)[number]) ? newRole : 'attendee';
    setUpdatingRole(userId);
    try {
      const { error } = await supabase
        .from('event_members')
        .update({ role })
        .eq('event_id', eventId)
        .eq('user_id', userId);
      if (error) throw error;
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    } catch {
      alert('Failed to update role');
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleRemoveMember = async (userId: string, fullName: string) => {
    if (!eventId || !confirm(`Remove ${fullName} from this event? They can rejoin with the event code.`)) return;
    setRemoving(userId);
    try {
      const { error } = await supabase.from('event_members').delete().eq('event_id', eventId).eq('user_id', userId);
      if (error) throw error;
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {
      alert('Failed to remove member');
    } finally {
      setRemoving(null);
    }
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        const { data: rows, error } = await supabase
          .from('event_members')
          .select('user_id, role, users!inner(full_name, email)')
          .eq('event_id', eventId)
          .order('role');
        if (error) throw error;
        const list: MemberRow[] = (rows ?? []).map((r: { user_id: string; role: string; users: { full_name: string; email: string } | { full_name: string; email: string }[] }) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          return { user_id: r.user_id, full_name: u?.full_name ?? '', email: u?.email ?? '', role: r.role };
        });
        if (!cancelled) setMembers(list);
      } catch {
        if (!cancelled) setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    e.target.value = '';
    setResult(null);
    setAdding(true);
    const notFound: string[] = [];
    let added = 0;
    let skipped = 0;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setResult({ added: 0, skipped: 0, notFound: ['CSV must have header and at least one row. Use: email,role (role optional, default attendee).'] });
        setAdding(false);
        return;
      }
      const header = parseCsvLine(lines[0] ?? '').map((h) => h.toLowerCase());
      const emailIdx = header.indexOf('email');
      const roleIdx = header.indexOf('role');
      if (emailIdx === -1) {
        setResult({ added: 0, skipped: 0, notFound: ['CSV must have an "email" column.'] });
        setAdding(false);
        return;
      }
      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i] ?? '');
        const email = (values[emailIdx] ?? '').trim().toLowerCase();
        if (!email) continue;
        const roleRaw = (roleIdx >= 0 ? values[roleIdx] ?? '' : '').trim().toLowerCase() || 'attendee';
        const role = ROLES.includes(roleRaw as (typeof ROLES)[number]) ? roleRaw : 'attendee';
        const { data: userRow } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
        const userId = (userRow as { id: string } | null)?.id;
        if (!userId) {
          notFound.push(email);
          skipped++;
          continue;
        }
        const { error } = await supabase.from('event_members').upsert(
          { event_id: eventId, user_id: userId, role },
          { onConflict: 'event_id,user_id' }
        );
        if (error) {
          skipped++;
          notFound.push(`${email}: ${error.message}`);
        } else {
          added++;
        }
      }
      setResult({ added, skipped, notFound: notFound.slice(0, 30) });
      if (added > 0) {
        const { data: rows } = await supabase
          .from('event_members')
          .select('user_id, role, users!inner(full_name, email)')
          .eq('event_id', eventId)
          .order('role');
        const list: MemberRow[] = (rows ?? []).map((r: { user_id: string; role: string; users: { full_name: string; email: string } | { full_name: string; email: string }[] }) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          return { user_id: r.user_id, full_name: u?.full_name ?? '', email: u?.email ?? '', role: r.role };
        });
        setMembers(list);
      }
    } catch (err) {
      setResult({
        added: 0,
        skipped: 0,
        notFound: [err instanceof Error ? err.message : 'Failed to process CSV'],
      });
    } finally {
      setAdding(false);
    }
  };

  const downloadUserTemplate = () => {
    const csv = 'email\nuser1@example.com\nuser2@example.com';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-emails-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkCreateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (bulkPassword.length < 8) {
      setBulkResult({ created: 0, failed: 0, errors: ['Set a default password (at least 8 characters) first.'] });
      return;
    }
    setBulkResult(null);
    setBulkCreating(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const header = lines[0] ?? '';
      const emailIdx = parseCsvLine(header).map((h) => h.toLowerCase()).indexOf('email');
      if (emailIdx === -1) {
        setBulkResult({ created: 0, failed: 0, errors: ['CSV must have an "email" column.'] });
        setBulkCreating(false);
        return;
      }
      const emails: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i] ?? '');
        const email = (values[emailIdx] ?? '').trim().toLowerCase();
        if (email && email.includes('@')) emails.push(email);
      }
      if (emails.length === 0) {
        setBulkResult({ created: 0, failed: 0, errors: ['No valid emails in CSV.'] });
        setBulkCreating(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setBulkResult({ created: 0, failed: 0, errors: ['You must be signed in.'] });
        setBulkCreating(false);
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-create-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          emails,
          default_password: bulkPassword,
          event_id: eventId || undefined,
          role: eventId ? bulkRole : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; created?: number; failed?: number; errors?: string[] };
      if (!res.ok) {
        setBulkResult({ created: 0, failed: 0, errors: [data.error ?? `Request failed (${res.status})`] });
        setBulkCreating(false);
        return;
      }
      setBulkResult({
        created: data.created ?? 0,
        failed: data.failed ?? 0,
        errors: data.errors ?? [],
      });
      if ((data.created ?? 0) > 0) {
        const { data: rows } = await supabase
          .from('event_members')
          .select('user_id, role, users!inner(full_name, email)')
          .eq('event_id', eventId!)
          .order('role');
        const list: MemberRow[] = (rows ?? []).map((r: { user_id: string; role: string; users: { full_name: string; email: string } | { full_name: string; email: string }[] }) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          return { user_id: r.user_id, full_name: u?.full_name ?? '', email: u?.email ?? '', role: r.role };
        });
        setMembers(list);
      }
    } catch (err) {
      setBulkResult({
        created: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : 'Failed to create accounts'],
      });
    } finally {
      setBulkCreating(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Members — {event?.name ?? 'Event'}</h1>

      <section className={styles.bulkSection}>
        <h2 className={styles.listTitle}>Create new user accounts (bulk)</h2>
        <p className={styles.hint}>
          Download a template, fill in one email per row, then upload. Each user gets a default password and must change it on first sign-in.
        </p>
        <div className={styles.bulkRow}>
          <button type="button" className={styles.importBtn} onClick={downloadUserTemplate}>
            Download template (email)
          </button>
          <input
            ref={bulkFileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleBulkCreateFile}
            style={{ display: 'none' }}
          />
          <label className={styles.bulkLabel}>
            Default password (min 8 chars):{' '}
            <input
              type="password"
              className={styles.bulkInput}
              value={bulkPassword}
              onChange={(e) => setBulkPassword(e.target.value)}
              placeholder="e.g. ChangeMe123"
              minLength={8}
            />
          </label>
          {eventId && (
            <label className={styles.bulkLabel}>
              Add to this event as:{' '}
              <select
                className={styles.bulkSelect}
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={bulkCreating || bulkPassword.length < 8}
            className={styles.importBtn}
            onClick={() => bulkFileInputRef.current?.click()}
          >
            {bulkCreating ? 'Creating…' : 'Upload CSV and create accounts'}
          </button>
        </div>
        {bulkResult && (
          <div className={styles.result}>
            <strong>Bulk create:</strong> {bulkResult.created} created, {bulkResult.failed} failed.
            {bulkResult.errors.length > 0 && (
              <ul className={styles.errorList}>
                {bulkResult.errors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <h2 className={styles.listTitle}>Add existing users to this event</h2>
      <p className={styles.hint}>
        CSV: <code>email,role</code> (role optional: attendee, speaker, vendor, admin). Users not in the app are skipped.
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
          disabled={adding}
          className={styles.importBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          {adding ? 'Adding…' : 'Add from CSV (batch)'}
        </button>
      </div>
      {result && (
        <div className={styles.result}>
          <strong>Result:</strong> {result.added} added, {result.skipped} skipped.
          {result.notFound.length > 0 && (
            <ul className={styles.errorList}>
              {result.notFound.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {result.notFound.length >= 30 && <li>…and more</li>}
            </ul>
          )}
        </div>
      )}
      <h2 className={styles.listTitle}>Members ({members.length})</h2>
      {members.length === 0 ? (
        <p className={styles.empty}>No members yet. Add via CSV or have users join with the event code in the app.</p>
      ) : (
        <ul className={styles.list}>
          {members.map((m) => (
            <li key={m.user_id} className={styles.item}>
              <div className={styles.itemRow}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{m.full_name}</span>
                  <span className={styles.itemMeta}>{m.email} · {m.role}</span>
                </div>
                <div className={styles.itemActions}>
                  <select
                    className={styles.roleSelect}
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                    disabled={!!updatingRole}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => handleRemoveMember(m.user_id, m.full_name)}
                    disabled={!!removing}
                  >
                    {removing === m.user_id ? '…' : 'Remove'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
