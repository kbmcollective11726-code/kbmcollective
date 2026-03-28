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

/** Raw `role` cell is sent to bulk-create-users; comma-separated values become `event_members.roles` (same as the app). */
export type CsvMemberRow = { email: string; full_name?: string; role?: string; roles?: string[] };

/** Parse role cell into valid roles (deduped, order preserved). Empty → [fallback]. */
function rolesFromCsvCell(roleCellRaw: string, fallback: string): string[] {
  const fb = ROLES.includes(fallback as (typeof ROLES)[number]) ? fallback : 'attendee';
  const cell = roleCellRaw.trim().toLowerCase();
  if (!cell) return [fb];
  const parts = cell.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((p) => ROLES.includes(p as (typeof ROLES)[number]));
  const deduped = [...new Set(valid)];
  if (deduped.length > 0) return deduped;
  if (ROLES.includes(cell as (typeof ROLES)[number])) return [cell];
  return [fb];
}

/** Parse CSV with columns: email (required), full_name or name (optional), role (optional). */
export function parseMemberCsv(text: string, defaultRole: string): { rows: CsvMemberRow[]; error?: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], error: 'CSV must have a header row and at least one data row.' };
  }
  const header = parseCsvLine(lines[0] ?? '').map((h) => h.toLowerCase().trim());
  const emailIdx = header.indexOf('email');
  if (emailIdx === -1) {
    return { rows: [], error: 'CSV must include an "email" column.' };
  }
  const nameIdx = header.includes('full_name') ? header.indexOf('full_name') : header.indexOf('name');
  const roleIdx = header.indexOf('role');
  const dr = ROLES.includes(defaultRole as (typeof ROLES)[number]) ? defaultRole : 'attendee';
  const rows: CsvMemberRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i] ?? '');
    const email = (values[emailIdx] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const fn = nameIdx >= 0 ? (values[nameIdx] ?? '').trim() : '';
    const roleCell = roleIdx >= 0 ? (values[roleIdx] ?? '').trim() : '';
    const roles = rolesFromCsvCell(roleCell, dr);
    rows.push({
      email,
      full_name: fn || undefined,
      role: roleCell.length > 0 ? roleCell : undefined,
      roles,
    });
  }
  if (rows.length === 0) {
    return { rows: [], error: 'No valid email rows found.' };
  }
  return { rows };
}

/** Refresh session so Edge Functions get a valid JWT (reduces 401 after the tab was idle). */
async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function parseEdgeErrorJson(res: Response): Promise<{ error?: string }> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return {};
  }
}

function edgeHttpErrorMessage(status: number, body: { error?: string }): string {
  if (body.error) return body.error;
  if (status === 401) {
    return 'Unauthorized (401). Sign out and sign in again, then retry. Also confirm Vercel env uses the same Supabase project as this admin login, and deploy the bulk-create-users Edge Function.';
  }
  if (status === 403) {
    return 'Forbidden (403). You must be a platform admin or an event admin for this event.';
  }
  return `Request failed (${status})`;
}

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
  const [result, setResult] = useState<{ linked: number; failed: number; errors: string[] } | null>(null);
  const [bulkPassword, setBulkPassword] = useState('');
  const [bulkRole, setBulkRole] = useState<string>('attendee');
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    created: number;
    linked: number;
    failed: number;
    errors: string[];
  } | null>(null);
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

  const reloadMembers = async () => {
    if (!eventId) return;
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
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    e.target.value = '';
    setResult(null);
    setAdding(true);
    try {
      const text = await file.text();
      const parsed = parseMemberCsv(text, 'attendee');
      if (parsed.error) {
        setResult({ linked: 0, failed: 0, errors: [parsed.error] });
        setAdding(false);
        return;
      }
      const token = await getEdgeFunctionAccessToken();
      if (!token) {
        setResult({ linked: 0, failed: 0, errors: ['You must be signed in.'] });
        setAdding(false);
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-create-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rows: parsed.rows,
          event_id: eventId,
          link_only: true,
        }),
      });
      const data = (await parseEdgeErrorJson(res)) as {
        error?: string;
        linked?: number;
        failed?: number;
        errors?: string[];
      };
      if (!res.ok) {
        setResult({ linked: 0, failed: 0, errors: [edgeHttpErrorMessage(res.status, data)] });
        setAdding(false);
        return;
      }
      const errors = data.errors ?? [];
      setResult({
        linked: data.linked ?? 0,
        failed: data.failed ?? errors.length,
        errors: errors.slice(0, 30),
      });
      if ((data.linked ?? 0) > 0) await reloadMembers();
    } catch (err) {
      setResult({
        linked: 0,
        failed: 0,
        errors: [err instanceof Error ? err.message : 'Failed to process CSV'],
      });
    } finally {
      setAdding(false);
    }
  };

  const downloadMembersTemplate = () => {
    const csv =
      'full_name,email,role\nJane Doe,jane@example.com,attendee\nAcme Vendor,vendor@example.com,vendor\n"Speaker + vendor",speaker@example.com,"attendee,speaker,vendor"';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkCreateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !eventId) return;
    if (bulkPassword.length < 8) {
      setBulkResult({ created: 0, linked: 0, failed: 0, errors: ['Set a default password (at least 8 characters) first.'] });
      return;
    }
    setBulkResult(null);
    setBulkCreating(true);
    try {
      const text = await file.text();
      const parsed = parseMemberCsv(text, bulkRole);
      if (parsed.error) {
        setBulkResult({ created: 0, linked: 0, failed: 0, errors: [parsed.error] });
        setBulkCreating(false);
        return;
      }
      const token = await getEdgeFunctionAccessToken();
      if (!token) {
        setBulkResult({ created: 0, linked: 0, failed: 0, errors: ['You must be signed in.'] });
        setBulkCreating(false);
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-create-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rows: parsed.rows,
          default_password: bulkPassword,
          event_id: eventId,
          link_only: false,
        }),
      });
      const data = (await parseEdgeErrorJson(res)) as {
        error?: string;
        created?: number;
        linked?: number;
        failed?: number;
        errors?: string[];
      };
      if (!res.ok) {
        setBulkResult({ created: 0, linked: 0, failed: 0, errors: [edgeHttpErrorMessage(res.status, data)] });
        setBulkCreating(false);
        return;
      }
      setBulkResult({
        created: data.created ?? 0,
        linked: data.linked ?? 0,
        failed: data.failed ?? 0,
        errors: data.errors ?? [],
      });
      if ((data.created ?? 0) + (data.linked ?? 0) > 0) await reloadMembers();
    } catch (err) {
      setBulkResult({
        created: 0,
        linked: 0,
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
          <strong>Buttons:</strong> <em>Download CSV template</em> — sample file. <em>Default password</em> — used for brand-new accounts only (min 8 characters).
          <em>Default role</em> — used when a row has no <code>role</code> column or it’s empty. <em>Upload CSV and create accounts</em> — pick your filled CSV to run the import.
          Columns: <code>full_name</code>, <code>email</code>, and optional <code>role</code>. If you skip <code>role</code> or leave it empty, the default role above is used.
          Use one or more roles per row: <code>attendee</code>, <code>speaker</code>, <code>vendor</code>, <code>admin</code>. Separate multiple roles with commas (e.g. <code>attendee,speaker,vendor</code>) — same as in the app.
          New users get this password and must change it on first sign-in. Existing emails are linked to the event (name updated if provided).
        </p>
        <div className={styles.bulkRow}>
          <button type="button" className={styles.importBtn} onClick={downloadMembersTemplate}>
            Download CSV template
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
              Default role (when CSV has no role column):{' '}
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
            <strong>Bulk create:</strong> {bulkResult.created} new accounts, {bulkResult.linked} linked to event
            (already existed), {bulkResult.failed} failed.
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
        <strong>Button:</strong> <em>Add from CSV (batch)</em> — upload the same CSV format; <strong>no password</strong> (only accounts that already exist in the app are linked; others are listed as errors).
        Columns: <code>full_name</code>, <code>email</code>, <code>role</code> (optional). Names are updated when provided. Multiple roles in one cell are comma-separated (e.g. <code>attendee,speaker,vendor</code>).
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
          <strong>Result:</strong> {result.linked} linked to event, {result.failed} failed / skipped.
          {result.errors.length > 0 && (
            <ul className={styles.errorList}>
              {result.errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {result.errors.length >= 30 && <li>…and more</li>}
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
