import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, supabaseUrl, edgeFunctionHeaders } from '../lib/supabase';
import { adminResetUserPassword } from '../lib/adminResetUserPassword';
import TransferMeetingsModal from '../components/TransferMeetingsModal';
import type { MemberPickOption } from '../components/MemberSearchSelect';
import type { Event } from '../lib/types';
import styles from './Members.module.css';

type MemberRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  last_login_at: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  linkedin_url: string | null;
  bio: string | null;
};

/** Fewer pages for long rosters; search still narrows the full list before slicing */
const PAGE_SIZE = 20;

type ProfileFormState = {
  full_name: string;
  email: string;
  title: string;
  company: string;
  phone: string;
  linkedin_url: string;
  bio: string;
};

function memberToForm(m: MemberRow): ProfileFormState {
  return {
    full_name: m.full_name,
    email: m.email,
    title: m.title ?? '',
    company: m.company ?? '',
    phone: m.phone ?? '',
    linkedin_url: m.linkedin_url ?? '',
    bio: m.bio ?? '',
  };
}

function MemberEditModal({
  member,
  eventId,
  onClose,
  onSaved,
}: {
  member: MemberRow;
  eventId: string;
  onClose: () => void;
  onSaved: (row: MemberRow) => void;
}) {
  const [form, setForm] = useState<ProfileFormState>(() => memberToForm(member));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(memberToForm(member));
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  }, [member]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const full_name = form.full_name.trim();
    const email = form.email.trim().toLowerCase();
    if (!full_name) {
      setError('Name is required.');
      return;
    }
    if (!email || !email.includes('@')) {
      setError('A valid email is required.');
      return;
    }
    const pw = newPassword.trim();
    const pw2 = confirmPassword.trim();
    const wantsPassword = pw.length > 0 || pw2.length > 0;
    if (wantsPassword) {
      if (pw.length < 8) {
        setError('New password must be at least 8 characters.');
        return;
      }
      if (pw !== pw2) {
        setError('Passwords do not match.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        full_name,
        email,
        title: form.title.trim() || null,
        company: form.company.trim() || null,
        phone: form.phone.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        bio: form.bio.trim() || null,
      };
      const { error: upErr } = await supabase.from('users').update(payload).eq('id', member.user_id);
      if (upErr) throw upErr;

      const memberEmailNorm = member.email.trim().toLowerCase();
      const emailChanged = email !== memberEmailNorm;
      const needsAuthSync = wantsPassword || emailChanged;
      if (needsAuthSync) {
        const pwdRes = await adminResetUserPassword({
          userId: member.user_id,
          eventId,
          ...(wantsPassword ? { newPassword: pw } : {}),
          ...(emailChanged ? { newEmail: email } : {}),
        });
        if (!pwdRes.ok) {
          setError(
            `Profile saved, but sign-in could not be updated (Auth password/email): ${pwdRes.message}`
          );
          onSaved({ ...member, ...payload });
          return;
        }
      }
      onSaved({ ...member, ...payload });
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : 'Failed to save profile';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof ProfileFormState, opts?: { multiline?: boolean; type?: string }) => (
    <label className={styles.modalLabel}>
      {label}
      {opts?.multiline ? (
        <textarea
          className={styles.modalTextarea}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          rows={3}
        />
      ) : (
        <input
          type={opts?.type ?? 'text'}
          className={styles.modalInput}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </label>
  );

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-edit-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 id="member-edit-title" className={styles.modalTitle}>
          Edit member profile
        </h2>
        <p className={styles.modalHint}>
          Changes apply to this user across the app. Email must stay unique. If you change email or set a password, we
          also update Supabase Auth so mobile sign-in uses the same email and password.
        </p>
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {field('Full name', 'full_name')}
          {field('Email', 'email', { type: 'email' })}
          <p className={styles.modalPasswordHint}>
            Optional — set a new sign-in password (no email). Min 8 characters. They will be asked to change it on next login.
          </p>
          <label className={styles.modalLabel}>
            New password
            <input
              type="password"
              className={styles.modalInput}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
            />
          </label>
          <label className={styles.modalLabel}>
            Confirm new password
            <input
              type="password"
              className={styles.modalInput}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
            />
          </label>
          {field('Title', 'title')}
          {field('Company', 'company')}
          {field('Phone', 'phone')}
          {field('LinkedIn URL', 'linkedin_url')}
          {field('Bio', 'bio', { multiline: true })}
          {error ? <p className={styles.modalError}>{error}</p> : null}
          <div className={styles.modalActions}>
            <button type="button" className={styles.modalBtnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.modalBtnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ROLES = ['attendee', 'speaker', 'vendor', 'admin'] as const;

/** Raw `role` cell is sent to bulk-create-users; comma-separated values become `event_members.roles` (same as the app). */
export type CsvMemberRow = {
  email: string;
  full_name?: string;
  title?: string;
  company?: string;
  role?: string;
  roles?: string[];
};

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

/** Parse CSV: email (required); optional full_name/name, title/job_title, company/organization, role. */
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
  const titleIdx = header.includes('title') ? header.indexOf('title') : header.indexOf('job_title');
  const companyIdx = header.includes('company')
    ? header.indexOf('company')
    : header.indexOf('organization');
  const dr = ROLES.includes(defaultRole as (typeof ROLES)[number]) ? defaultRole : 'attendee';
  const rows: CsvMemberRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i] ?? '');
    const email = (values[emailIdx] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const fn = nameIdx >= 0 ? (values[nameIdx] ?? '').trim() : '';
    const roleCell = roleIdx >= 0 ? (values[roleIdx] ?? '').trim() : '';
    const titleCell = titleIdx >= 0 ? (values[titleIdx] ?? '').trim() : '';
    const companyCell = companyIdx >= 0 ? (values[companyIdx] ?? '').trim() : '';
    const roles = rolesFromCsvCell(roleCell, dr);
    rows.push({
      email,
      full_name: fn || undefined,
      title: titleCell || undefined,
      company: companyCell || undefined,
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

/** Escape `%` and `_` for Postgres ILIKE patterns. */
function escapeForIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

type SearchableUser = {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  company: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  // Parse one field per iteration, then consume the trailing delimiter comma.
  // This keeps quoted fields that contain commas (e.g. "Director, Talent") in a single column.
  for (;;) {
    let val = '';
    if (line[i] === '"') {
      i++;
      while (i < n) {
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
      // Ignore any stray characters (e.g. whitespace) between the closing quote and the next comma.
      while (i < n && line[i] !== ',') i++;
    } else {
      const comma = line.indexOf(',', i);
      const end = comma === -1 ? n : comma;
      val = line.slice(i, end).trim();
      i = end;
    }
    out.push(val);
    if (i >= n) break;
    i++;
  }
  return out;
}

type JoinedUser = {
  full_name: string;
  email: string;
  last_login_at: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  linkedin_url: string | null;
  bio: string | null;
};

type JoinedMemberRow = {
  user_id: string;
  role: string;
  users: JoinedUser | JoinedUser[];
};

function memberRowFromJoin(r: JoinedMemberRow): MemberRow {
  const u = Array.isArray(r.users) ? r.users[0] : r.users;
  return {
    user_id: r.user_id,
    full_name: u?.full_name ?? '',
    email: u?.email ?? '',
    role: r.role,
    last_login_at: u?.last_login_at ?? null,
    title: u?.title ?? null,
    company: u?.company ?? null,
    phone: u?.phone ?? null,
    linkedin_url: u?.linkedin_url ?? null,
    bio: u?.bio ?? null,
  };
}

/** Full text for tooltips / accessibility */
function formatLastLoginFull(lastLoginAt: string | null): string {
  if (!lastLoginAt) return 'Never logged in';
  const parsed = new Date(lastLoginAt);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

/** Compact value for the right-hand column */
function formatLastLoginCell(lastLoginAt: string | null): string {
  if (!lastLoginAt) return 'Never';
  const parsed = new Date(lastLoginAt);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

async function fetchEventMembersWithOptionalLastLogin(eventId: string) {
  const withLastLogin = await supabase
    .from('event_members')
    .select(
      'user_id, role, users!inner(full_name, email, last_login_at, title, company, phone, linkedin_url, bio)'
    )
    .eq('event_id', eventId)
    .order('role');

  if (!withLastLogin.error) return withLastLogin;

  // Backward-compatible fallback while DB migration is rolling out.
  return supabase
    .from('event_members')
    .select(
      'user_id, role, users!inner(full_name, email, title, company, phone, linkedin_url, bio)'
    )
    .eq('event_id', eventId)
    .order('role');
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
  const [singleEmail, setSingleEmail] = useState('');
  const [singleFullName, setSingleFullName] = useState('');
  const [singlePassword, setSinglePassword] = useState('');
  const [singleRole, setSingleRole] = useState<string>('attendee');
  const [singleCreating, setSingleCreating] = useState(false);
  const [singleResult, setSingleResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [loginFilter, setLoginFilter] = useState<'all' | 'never'>('all');
  const [page, setPage] = useState(1);
  const [editingMember, setEditingMember] = useState<MemberRow | null>(null);
  const [transferSource, setTransferSource] = useState<MemberRow | null>(null);
  const membersListStartRef = useRef<HTMLHeadingElement>(null);
  const addToolsRef = useRef<HTMLDetailsElement>(null);
  const skipScrollToMembersOnPage = useRef(true);
  const [addToolsOpen, setAddToolsOpen] = useState(false);
  const [existingUserSearch, setExistingUserSearch] = useState('');
  const [existingUserHits, setExistingUserHits] = useState<SearchableUser[]>([]);
  const [existingUserSearchLoading, setExistingUserSearchLoading] = useState(false);
  const [addExistingSearchRole, setAddExistingSearchRole] = useState<string>('attendee');
  const [addExistingSearchError, setAddExistingSearchError] = useState<string | null>(null);
  const [addingExistingUserId, setAddingExistingUserId] = useState<string | null>(null);

  const memberIdSet = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const memberPickOptions = useMemo((): MemberPickOption[] => {
    return members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      user: { full_name: m.full_name, email: m.email },
    }));
  }, [members]);

  useEffect(() => {
    const q = existingUserSearch.trim();
    if (q.length < 2) {
      setExistingUserHits([]);
      setExistingUserSearchLoading(false);
      setAddExistingSearchError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setExistingUserSearchLoading(true);
      setAddExistingSearchError(null);
      const pattern = `%${escapeForIlike(q)}%`;
      try {
        const [nameRes, emailRes] = await Promise.all([
          supabase
            .from('users')
            .select('id, full_name, email, title, company')
            .eq('is_platform_admin', false)
            .ilike('full_name', pattern)
            .order('full_name', { ascending: true })
            .limit(20),
          supabase
            .from('users')
            .select('id, full_name, email, title, company')
            .eq('is_platform_admin', false)
            .ilike('email', pattern)
            .order('email', { ascending: true })
            .limit(20),
        ]);
        if (cancelled) return;
        const errMsg = nameRes.error?.message ?? emailRes.error?.message;
        if (errMsg) {
          setAddExistingSearchError(errMsg);
          setExistingUserHits([]);
          return;
        }
        const byId = new Map<string, SearchableUser>();
        for (const row of [...(nameRes.data ?? []), ...(emailRes.data ?? [])]) {
          const u = row as SearchableUser;
          if (u?.id) byId.set(u.id, u);
        }
        const merged = [...byId.values()].sort((a, b) =>
          (a.full_name || a.email).localeCompare(b.full_name || b.email, undefined, { sensitivity: 'base' })
        );
        setExistingUserHits(merged.slice(0, 25));
      } catch (e) {
        if (!cancelled) {
          setAddExistingSearchError(e instanceof Error ? e.message : 'Search failed');
          setExistingUserHits([]);
        }
      } finally {
        if (!cancelled) setExistingUserSearchLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [existingUserSearch]);

  const handleAddExistingFromSearch = async (user: SearchableUser) => {
    if (!eventId) return;
    const role = ROLES.includes(addExistingSearchRole as (typeof ROLES)[number]) ? addExistingSearchRole : 'attendee';
    if (memberIdSet.has(user.id)) {
      setAddExistingSearchError(`${user.full_name || user.email} is already a member of this event.`);
      return;
    }
    setAddingExistingUserId(user.id);
    setAddExistingSearchError(null);
    try {
      const { error } = await supabase.from('event_members').insert({
        event_id: eventId,
        user_id: user.id,
        role,
        roles: [role],
      });
      if (error) {
        const dup =
          error.code === '23505' ||
          /unique constraint|duplicate key/i.test(error.message ?? '');
        if (dup) {
          setAddExistingSearchError(`${user.full_name || user.email} is already on this event.`);
        } else {
          setAddExistingSearchError(error.message ?? 'Could not add member');
        }
        return;
      }
      await reloadMembers();
      setExistingUserHits((prev) => prev.filter((h) => h.id !== user.id));
    } finally {
      setAddingExistingUserId(null);
    }
  };

  const filteredMembers = useMemo(() => {
    let list = members;
    if (loginFilter === 'never') {
      list = list.filter((m) => !m.last_login_at);
    }
    const q = memberSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        m.user_id.toLowerCase().includes(q)
    );
  }, [members, memberSearch, loginFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));

  const paginatedMembers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredMembers.slice(start, start + PAGE_SIZE);
  }, [filteredMembers, page]);

  useEffect(() => {
    setPage(1);
  }, [memberSearch, loginFilter]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!loading && members.length === 0) setAddToolsOpen(true);
  }, [loading, members.length]);

  useEffect(() => {
    if (skipScrollToMembersOnPage.current) {
      skipScrollToMembersOnPage.current = false;
      return;
    }
    if (totalPages <= 1) return;
    membersListStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page, totalPages]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!eventId) return;
    const role = ROLES.includes(newRole as (typeof ROLES)[number]) ? newRole : 'attendee';
    setUpdatingRole(userId);
    try {
      const { error } = await supabase
        .from('event_members')
        .update({ role, roles: [role] })
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
        const { data: rows, error } = await fetchEventMembersWithOptionalLastLogin(eventId);
        if (error) throw error;
        const list: MemberRow[] = (rows ?? []).map((r) => memberRowFromJoin(r as JoinedMemberRow));
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
    const { data: rows } = await fetchEventMembersWithOptionalLastLogin(eventId);
    const list: MemberRow[] = (rows ?? []).map((r) => memberRowFromJoin(r as JoinedMemberRow));
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
        headers: edgeFunctionHeaders(token),
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

  const handleCreateSingleUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    const email = singleEmail.trim().toLowerCase();
    const fullName = singleFullName.trim();
    const pw = singlePassword.trim();
    setSingleResult(null);
    if (!email || !email.includes('@')) {
      setSingleResult({ ok: false, text: 'Enter a valid email address.' });
      return;
    }
    if (pw.length < 8) {
      setSingleResult({ ok: false, text: 'Password must be at least 8 characters.' });
      return;
    }
    const role = ROLES.includes(singleRole as (typeof ROLES)[number]) ? singleRole : 'attendee';
    setSingleCreating(true);
    try {
      const token = await getEdgeFunctionAccessToken();
      if (!token) {
        setSingleResult({ ok: false, text: 'You must be signed in.' });
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-create-users`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token),
        body: JSON.stringify({
          rows: [
            {
              email,
              ...(fullName ? { full_name: fullName } : {}),
              role,
            },
          ],
          default_password: pw,
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
        setSingleResult({ ok: false, text: edgeHttpErrorMessage(res.status, data) });
        return;
      }
      const created = data.created ?? 0;
      const linked = data.linked ?? 0;
      const errs = data.errors ?? [];
      if (created > 0) {
        setSingleResult({
          ok: true,
          text: 'Account created and added to this event. They must change the password on first sign-in.',
        });
        setSingleEmail('');
        setSingleFullName('');
        setSinglePassword('');
        await reloadMembers();
      } else if (linked > 0) {
        setSingleResult({
          ok: true,
          text: 'That email already had an account — they were linked to this event.',
        });
        setSingleEmail('');
        setSingleFullName('');
        setSinglePassword('');
        await reloadMembers();
      } else {
        setSingleResult({
          ok: false,
          text: errs[0] ?? 'No account was created. Check the email or try again.',
        });
      }
    } catch (err) {
      setSingleResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to create account',
      });
    } finally {
      setSingleCreating(false);
    }
  };

  const downloadMembersTemplate = () => {
    const csv =
      'full_name,email,title,company,role\nJane Doe,jane@example.com,Director of HR,Example Corp,attendee\nAcme Vendor,vendor@example.com,,,vendor\n"Speaker + vendor",speaker@example.com,Founder,Startup LLC,"attendee,speaker,vendor"';
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
        headers: edgeFunctionHeaders(token),
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
      <div className={styles.pageTop}>
        <h1>Members — {event?.name ?? 'Event'}</h1>
        {members.length > 0 ? (
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => membersListStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Jump to member list ↓
          </button>
        ) : null}
      </div>

      <details
        ref={addToolsRef}
        className={styles.addToolsPanel}
        open={addToolsOpen}
        onToggle={(e) => {
          if (e.target !== e.currentTarget) return;
          setAddToolsOpen((e.currentTarget as HTMLDetailsElement).open);
        }}
      >
        <summary className={styles.addToolsSummary}>
          <span className={styles.addToolsSummaryTitle}>Add members to this event</span>
          <span className={styles.addToolsSummaryHint}>Bulk CSV · create one account · link existing users</span>
        </summary>
        <div className={styles.addToolsBody}>
      <section className={styles.addMemberSection}>
        <h2 className={styles.listTitle}>Bulk import from CSV</h2>
        <p className={styles.hint}>
          Upload a CSV file with member details. Most common way to add multiple members at once.
        </p>
        <details
          className={styles.csvHelpDetails}
          onToggle={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <summary className={styles.csvHelpSummary} onClick={(e) => e.stopPropagation()}>
            How to prepare your CSV
          </summary>
          <div className={styles.csvHelpBody}>
            <p>
              Don&apos;t change the column headers in the template. Download it and fill in your member data — headers are
              already set up correctly.
            </p>
            <ul>
              <li>
                <strong>Required:</strong> <code>email</code>
              </li>
              <li>
                <strong>Optional:</strong> <code>full_name</code>, <code>title</code>, <code>company</code>,{' '}
                <code>role</code> (e.g. attendee, speaker, vendor, admin — comma-separated for multiple roles)
              </li>
              <li>If the <code>role</code> column is missing or empty, the default role below is used for each row.</li>
              <li>New emails get the default password. Existing emails are linked to this event (password unchanged).</li>
              <li>Save as <strong>CSV UTF-8</strong> from Excel to avoid import issues.</li>
            </ul>
          </div>
        </details>
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

      <section className={styles.addMemberSection}>
        <h2 className={styles.listTitle}>Create one account</h2>
        <p className={styles.hint}>
          Add a single new user with email and password. They are added to this event immediately. If the email already
          exists, they are only linked to the event (same as CSV). Password must be at least 8 characters; they change it
          on first sign-in.
        </p>
        <form className={styles.singleUserForm} onSubmit={handleCreateSingleUser}>
          <label className={styles.singleUserLabel}>
            Full name
            <input
              type="text"
              className={styles.bulkInput}
              value={singleFullName}
              onChange={(e) => setSingleFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </label>
          <label className={styles.singleUserLabel}>
            Email <span className={styles.singleUserRequired}>*</span>
            <input
              type="email"
              className={styles.bulkInput}
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="jane@company.com"
              autoComplete="email"
              required
            />
          </label>
          <label className={styles.singleUserLabel}>
            Password (min 8 chars) <span className={styles.singleUserRequired}>*</span>
            <input
              type="password"
              className={styles.bulkInput}
              value={singlePassword}
              onChange={(e) => setSinglePassword(e.target.value)}
              placeholder="Temporary password"
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className={styles.singleUserLabel}>
            Role
            <select
              className={styles.bulkSelect}
              value={singleRole}
              onChange={(e) => setSingleRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className={styles.singleUserActions}>
            <button
              type="submit"
              className={styles.importBtn}
              disabled={singleCreating || singlePassword.length < 8}
            >
              {singleCreating ? 'Creating…' : 'Create account & add to event'}
            </button>
          </div>
        </form>
        {singleResult ? (
          <div className={singleResult.ok ? styles.result : styles.resultError} role="status">
            {singleResult.text}
          </div>
        ) : null}
      </section>

      <section className={styles.addMemberSection}>
      <h2 className={styles.listTitle}>Add existing users to this event</h2>
      <p className={styles.hint}>
        <strong>Search and add</strong>
        <br />
        Find anyone already in the system by name or email. They&apos;ll be linked to this event without creating a new
        account.
      </p>
      <div className={styles.addExistingBlock}>
        <div className={styles.addExistingFieldsRow}>
          <div className={styles.addExistingSearchRow}>
            <label htmlFor="add-existing-user-search" className={styles.addExistingFieldLabel}>
              Search users
            </label>
            <input
              id="add-existing-user-search"
              type="search"
              className={styles.memberSearchInput}
              value={existingUserSearch}
              onChange={(e) => setExistingUserSearch(e.target.value)}
              placeholder="Name or email (min 2 characters)…"
              autoComplete="off"
            />
          </div>
          <div className={styles.addExistingRoleRow}>
            <label htmlFor="add-existing-search-role" className={styles.addExistingFieldLabel}>
              Role when adding from search
            </label>
            <select
              id="add-existing-search-role"
              className={styles.addExistingRoleSelect}
              value={addExistingSearchRole}
              onChange={(e) => setAddExistingSearchRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        {addExistingSearchError ? <p className={styles.addExistingError}>{addExistingSearchError}</p> : null}
        {existingUserSearch.trim().length > 0 && existingUserSearch.trim().length < 2 ? (
          <p className={styles.addExistingInlineMsg}>Type at least 2 characters to search.</p>
        ) : null}
        {existingUserSearchLoading ? (
          <p className={styles.addExistingInlineMsg}>Searching…</p>
        ) : null}
        {!existingUserSearchLoading &&
        existingUserSearch.trim().length >= 2 &&
        existingUserHits.length === 0 &&
        !addExistingSearchError ? (
          <p className={styles.addExistingInlineMsg}>No users match that search.</p>
        ) : null}
        {existingUserHits.length > 0 ? (
          <ul className={styles.addExistingResults} aria-label="Search results">
            {existingUserHits.map((u) => {
              const already = memberIdSet.has(u.id);
              return (
                <li key={u.id} className={styles.addExistingResult}>
                  <div className={styles.addExistingResultInfo}>
                    <div className={styles.addExistingResultName}>{u.full_name || '—'}</div>
                    <div className={styles.addExistingResultMeta}>
                      {u.email}
                      {u.title || u.company ? (
                        <>
                          <br />
                          {[u.title, u.company].filter(Boolean).join(' · ')}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.addExistingResultActions}>
                    <button
                      type="button"
                      className={styles.addExistingBtn}
                      disabled={already || addingExistingUserId === u.id}
                      onClick={() => handleAddExistingFromSearch(u)}
                    >
                      {already ? 'Already added' : addingExistingUserId === u.id ? 'Adding…' : 'Add to event'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <p className={styles.csvDivider}>Or add many at once from a file</p>
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
      </section>
        </div>
      </details>

      <section className={styles.membersListSection}>
      <h2 ref={membersListStartRef} className={styles.listTitle}>
        Members (
        {filteredMembers.length}
        {filteredMembers.length !== members.length ? ` of ${members.length}` : ''})
      </h2>
      {members.length > 0 && (
        <>
          <div className={styles.membersToolbar}>
            <div className={styles.searchRow}>
              <label htmlFor="member-search" className={styles.visuallyHidden}>
                Search members
              </label>
              <input
                id="member-search"
                type="search"
                className={styles.memberSearchInput}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search by name, email, or role…"
                autoComplete="off"
              />
            </div>
            <label className={styles.loginFilterLabel}>
              <span className={styles.loginFilterLabelText}>Login</span>
              <select
                className={styles.loginFilterSelect}
                value={loginFilter}
                onChange={(e) => setLoginFilter(e.target.value === 'never' ? 'never' : 'all')}
                aria-label="Filter members by login"
              >
                <option value="all">All members</option>
                <option value="never">Never logged in</option>
              </select>
            </label>
          </div>
          {filteredMembers.length > 0 ? (
            <p className={styles.searchMeta}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredMembers.length)} of{' '}
              {filteredMembers.length}
              {members.length !== filteredMembers.length ? ` (filtered from ${members.length})` : ''}
              {totalPages > 1 ? ` · Page ${page} / ${totalPages}` : ''}
            </p>
          ) : null}
        </>
      )}
      {members.length === 0 ? (
        <p className={styles.empty}>
          No members yet. Expand <strong>Add members to this event</strong> above to create accounts, import CSV, or link
          existing users—or have attendees join with the event code in the app.
        </p>
      ) : filteredMembers.length === 0 ? (
        <p className={styles.empty}>
          {loginFilter === 'never' && !memberSearch.trim()
            ? 'Everyone on this event has logged in at least once.'
            : memberSearch.trim()
              ? `No members match your search and filters (including "${memberSearch.trim()}").`
              : 'No members match the current filters.'}
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {paginatedMembers.map((m) => (
              <li key={m.user_id} className={styles.item}>
                <div className={styles.itemRow}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{m.full_name}</span>
                    <span className={styles.itemMeta}>
                      {m.email} · {m.role}
                      {m.title || m.company ? (
                        <>
                          <br />
                          {[m.title, m.company].filter(Boolean).join(' · ')}
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div className={styles.itemActions}>
                    <button type="button" className={styles.editBtn} onClick={() => setEditingMember(m)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.transferBtn}
                      onClick={() => setTransferSource(m)}
                      title="Move all B2B meetings to another member"
                    >
                      Transfer meetings
                    </button>
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
                    <div
                      className={styles.lastLoginCol}
                      title={m.last_login_at ? formatLastLoginFull(m.last_login_at) : 'No recorded sign-in yet'}
                    >
                      <span className={styles.lastLoginLabel}>Last login</span>
                      <span className={styles.lastLoginValue}>{formatLastLoginCell(m.last_login_at)}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
      </section>

      {editingMember && eventId ? (
        <MemberEditModal
          member={editingMember}
          eventId={eventId}
          onClose={() => setEditingMember(null)}
          onSaved={(row) => {
            setMembers((prev) => prev.map((m) => (m.user_id === row.user_id ? row : m)));
          }}
        />
      ) : null}
      {transferSource && eventId ? (
        <TransferMeetingsModal
          eventId={eventId}
          source={transferSource}
          memberOptions={memberPickOptions}
          onClose={() => setTransferSource(null)}
          onDone={() => {}}
        />
      ) : null}
    </div>
  );
}
