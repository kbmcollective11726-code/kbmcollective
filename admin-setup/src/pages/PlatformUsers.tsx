import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase, supabaseUrl, edgeFunctionHeaders } from '../lib/supabase';
import { adminResetUserPassword } from '../lib/adminResetUserPassword';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import styles from './PlatformUsers.module.css';

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  is_active: boolean | null;
  created_at: string | null;
};

const PAGE_SIZE = 20;

async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function PlatformUsers() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLHeadingElement>(null);
  const skipScrollForPage = useRef(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<
    Record<string, { full_name: string; is_platform_admin: boolean; is_active: boolean }>
  >({});
  const [passwordDrafts, setPasswordDrafts] = useState<
    Record<string, { new: string; confirm: string }>
  >({});

  const loadUsers = useCallback(async () => {
    setError('');
    const { data, error: qErr } = await supabase
      .from('users')
      .select('id, email, full_name, is_platform_admin, is_active, created_at')
      .order('email', { ascending: true, nullsFirst: false });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as UserRow[];
    setRows(list);
    const next: Record<string, { full_name: string; is_platform_admin: boolean; is_active: boolean }> = {};
    for (const u of list) {
      next[u.id] = {
        full_name: u.full_name ?? '',
        is_platform_admin: u.is_platform_admin === true,
        is_active: u.is_active !== false,
      };
    }
    setDrafts(next);
    setPasswordDrafts({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await isCurrentUserPlatformAdmin();
      if (cancelled) return;
      setAllowed(ok);
      if (!ok) {
        setLoading(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!cancelled) setCurrentUserId(user?.id ?? null);
      await loadUsers();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadUsers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        (u.full_name ?? '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (skipScrollForPage.current) {
      skipScrollForPage.current = false;
      return;
    }
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  const updateDraft = (
    id: string,
    patch: Partial<{ full_name: string; is_platform_admin: boolean; is_active: boolean }>
  ) => {
    setDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  const updatePasswordDraft = (id: string, patch: Partial<{ new: string; confirm: string }>) => {
    setPasswordDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { new: '', confirm: '' }), ...patch },
    }));
  };

  const handleSave = async (u: UserRow) => {
    const d = drafts[u.id];
    if (!d) return;
    const fn = d.full_name.trim();
    if (!fn) {
      setError('Full name cannot be empty.');
      return;
    }
    const pw = passwordDrafts[u.id];
    const pwNew = pw?.new?.trim() ?? '';
    const pwConfirm = pw?.confirm?.trim() ?? '';
    const wantsPassword = pwNew.length > 0 || pwConfirm.length > 0;
    if (wantsPassword) {
      if (pwNew.length < 8) {
        setError('New password must be at least 8 characters.');
        return;
      }
      if (pwNew !== pwConfirm) {
        setError('Passwords do not match.');
        return;
      }
    }
    setError('');
    setSavingId(u.id);
    try {
      const payload: Record<string, unknown> = {
        full_name: fn,
        is_platform_admin: d.is_platform_admin,
        is_active: d.is_active,
      };
      const { error: upErr } = await supabase.from('users').update(payload).eq('id', u.id);
      if (upErr) throw upErr;
      setRows((prev) =>
        prev.map((r) =>
          r.id === u.id
            ? {
                ...r,
                full_name: fn,
                is_platform_admin: d.is_platform_admin,
                is_active: d.is_active,
              }
            : r
        )
      );
      if (wantsPassword) {
        const pwdRes = await adminResetUserPassword({
          userId: u.id,
          newPassword: pwNew,
        });
        if (!pwdRes.ok) {
          setError(`Profile saved, but password could not be set: ${pwdRes.message}`);
          return;
        }
        setPasswordDrafts((prev) => ({ ...prev, [u.id]: { new: '', confirm: '' } }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (u.id === currentUserId) return;
    const ok = window.confirm(
      `Permanently delete "${u.full_name || u.email}"? All their data (posts, memberships, messages, etc.) will be removed. This cannot be undone.`
    );
    if (!ok) return;
    setError('');
    setDeletingId(u.id);
    try {
      await refreshSupabaseSessionIfNeeded();
      const token = await getEdgeFunctionAccessToken();
      if (!token || !supabaseUrl) throw new Error('Not signed in or missing Supabase URL.');
      const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
        method: 'POST',
        headers: edgeFunctionHeaders(token),
        body: JSON.stringify({ user_id: u.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg =
          res.status === 401
            ? body.error ||
              'Unauthorized (401). Sign out and sign in again, then retry. If this persists, redeploy the delete-user Edge Function with verify_jwt disabled (see supabase/config.toml).'
            : body.error || `Request failed (${res.status})`;
        throw new Error(msg);
      }
      setRows((prev) => prev.filter((r) => r.id !== u.id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const isDirty = (u: UserRow) => {
    const d = drafts[u.id];
    if (!d) return false;
    const profileDirty =
      d.full_name !== (u.full_name ?? '') ||
      d.is_platform_admin !== (u.is_platform_admin === true) ||
      d.is_active !== (u.is_active !== false);
    const p = passwordDrafts[u.id];
    const passwordDirty = !!(p?.new?.trim() || p?.confirm?.trim());
    return profileDirty || passwordDirty;
  };

  if (allowed === false) {
    return <Navigate to="/" replace />;
  }

  if (allowed === null || loading) {
    return <div className={styles.loading}>Loading…</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to="/" className={styles.back}>
          ← All events
        </Link>
        <h1>All users</h1>
        <p className={styles.hint}>
          Platform admin only. Edit profiles, grant or revoke platform admin, deactivate accounts, set a new sign-in
          password (no email — instant update), or delete users (same as the mobile tool). Run the latest database
          migration if saving returns a permission error.
        </p>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}

      <h2 ref={listTopRef} className={styles.listTitle}>
        Users ({rows.length})
      </h2>
      <div className={styles.searchRow}>
        <label htmlFor="platform-users-search" className={styles.searchLabel}>
          Search users
        </label>
        <input
          id="platform-users-search"
          type="search"
          className={styles.search}
          placeholder="Search by email, name, or user id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>
      {filtered.length > 0 ? (
        <p className={styles.searchMeta}>
          {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          {rows.length !== filtered.length ? ` (filtered from ${rows.length} total)` : ''}
          {totalPages > 1 ? ` · Page ${page} / ${totalPages}` : ''}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className={styles.empty}>No users in the database.</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No users match your search.</p>
      ) : (
        <>
        <ul className={styles.list}>
          {paginated.map((u) => {
            const d = drafts[u.id];
            const self = u.id === currentUserId;
            return (
              <li key={u.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.email}>{u.email}</span>
                  <div className={styles.badges}>
                    {u.is_platform_admin ? <span className={styles.badge}>Platform admin</span> : null}
                    {u.is_active === false ? (
                      <span className={styles.badgeMuted}>Inactive</span>
                    ) : null}
                  </div>
                </div>
                {d ? (
                  <div className={styles.fields}>
                    <label className={styles.label}>
                      Full name
                      <input
                        className={styles.input}
                        value={d.full_name}
                        onChange={(e) => updateDraft(u.id, { full_name: e.target.value })}
                      />
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={d.is_platform_admin}
                        disabled={self}
                        onChange={(e) => updateDraft(u.id, { is_platform_admin: e.target.checked })}
                      />
                      Platform admin
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={d.is_active}
                        onChange={(e) => updateDraft(u.id, { is_active: e.target.checked })}
                      />
                      Active
                    </label>
                    <div className={styles.passwordBlock}>
                      <p className={styles.passwordHint}>
                        New password (optional) — applies immediately; user is prompted to change on next login.
                      </p>
                      <label className={styles.label}>
                        New password
                        <input
                          type="password"
                          className={styles.input}
                          value={passwordDrafts[u.id]?.new ?? ''}
                          onChange={(e) => updatePasswordDraft(u.id, { new: e.target.value })}
                          autoComplete="new-password"
                          placeholder="Leave blank to keep current"
                        />
                      </label>
                      <label className={styles.label}>
                        Confirm password
                        <input
                          type="password"
                          className={styles.input}
                          value={passwordDrafts[u.id]?.confirm ?? ''}
                          onChange={(e) => updatePasswordDraft(u.id, { confirm: e.target.value })}
                          autoComplete="new-password"
                          placeholder="Leave blank to keep current"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
                {self ? (
                  <p className={styles.selfNote}>
                    You cannot remove your own platform admin flag here (avoids locking yourself out).
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={!isDirty(u) || savingId === u.id}
                    onClick={() => handleSave(u)}
                  >
                    {savingId === u.id ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    disabled={self || deletingId === u.id}
                    onClick={() => handleDelete(u)}
                  >
                    {deletingId === u.id ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
              </li>
            );
          })}
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
    </div>
  );
}
