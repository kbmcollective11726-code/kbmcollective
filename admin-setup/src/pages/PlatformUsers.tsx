import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseUrl, edgeFunctionHeaders } from '../lib/supabase';
import { adminResetUserPassword } from '../lib/adminResetUserPassword';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import { logPlatformAudit } from '../lib/logPlatformAudit';
import styles from './PlatformUsers.module.css';

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  is_active: boolean | null;
  created_at: string | null;
};

type UserEventMembership = {
  eventId: string;
  eventName: string;
  roleLabel: string;
};

type EventOption = {
  id: string;
  name: string;
  memberCount: number;
};

type StatusFilter = 'all' | 'active' | 'inactive';

const PAGE_SIZE = 20;

function formatMemberRoles(role: string | null, roles: string[] | null): string {
  const parts: string[] = [];
  if (role) parts.push(role);
  if (roles?.length) {
    for (const r of roles) {
      if (r && !parts.includes(r)) parts.push(r);
    }
  }
  return parts.join(', ');
}

function displayName(u: UserRow): string {
  return u.full_name?.trim() || u.email;
}

async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function PlatformUsers() {
  const [searchParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const listTopRef = useRef<HTMLHeadingElement>(null);
  const skipScrollForPage = useRef(true);
  const [error, setError] = useState('');
  const [membershipsError, setMembershipsError] = useState('');
  const [membershipsByUser, setMembershipsByUser] = useState<Record<string, UserEventMembership[]>>(
    {}
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toggleActiveId, setToggleActiveId] = useState<string | null>(null);
  const [bulkDeactivating, setBulkDeactivating] = useState(false);

  const [drafts, setDrafts] = useState<
    Record<string, { full_name: string; is_platform_admin: boolean; is_active: boolean }>
  >({});
  const [passwordDrafts, setPasswordDrafts] = useState<
    Record<string, { new: string; confirm: string }>
  >({});

  const loadUsers = useCallback(async () => {
    setError('');
    setMembershipsError('');
    const { data, error: qErr } = await supabase
      .from('users')
      .select('id, email, full_name, is_platform_admin, is_active, created_at')
      .order('email', { ascending: true, nullsFirst: false });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setMembershipsByUser({});
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

    type EmRow = {
      user_id: string;
      role: string;
      roles: string[] | null;
      event_id: string;
      events: { id: string; name: string } | { id: string; name: string }[] | null;
    };
    const { data: emData, error: emErr } = await supabase
      .from('event_members')
      .select('user_id, role, roles, event_id, events(id, name)');
    if (emErr) {
      setMembershipsError(emErr.message);
      setMembershipsByUser({});
      return;
    }
    const byUser: Record<string, UserEventMembership[]> = {};
    for (const row of (emData ?? []) as unknown as EmRow[]) {
      const uid = row.user_id;
      const evRaw = row.events;
      const ev = Array.isArray(evRaw) ? evRaw[0] ?? null : evRaw;
      const eventName = ev?.name?.trim() || 'Event (unavailable)';
      const eventId = ev?.id ?? row.event_id;
      const roleLabel = formatMemberRoles(row.role, row.roles);
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid]!.push({ eventId, eventName, roleLabel });
    }
    for (const uid of Object.keys(byUser)) {
      const list = byUser[uid];
      if (list) {
        list.sort((a, b) => a.eventName.localeCompare(b.eventName, undefined, { sensitivity: 'base' }));
      }
    }
    setMembershipsByUser(byUser);
  }, []);

  useEffect(() => {
    const q = searchParams.get('search')?.trim();
    if (q) setSearch(q);
    const ev = searchParams.get('event')?.trim();
    if (ev) setEventFilter(ev);
  }, [searchParams]);

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

  const eventOptions = useMemo((): EventOption[] => {
    const map = new Map<string, { name: string; count: number }>();
    for (const memberships of Object.values(membershipsByUser)) {
      for (const m of memberships) {
        const cur = map.get(m.eventId);
        if (cur) cur.count += 1;
        else map.set(m.eventId, { name: m.eventName, count: 1 });
      }
    }
    return Array.from(map.entries())
      .map(([id, { name, count }]) => ({ id, name, memberCount: count }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [membershipsByUser]);

  const selectedEvent = useMemo(
    () => eventOptions.find((e) => e.id === eventFilter) ?? null,
    [eventOptions, eventFilter]
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (eventFilter) {
      list = list.filter((u) =>
        (membershipsByUser[u.id] ?? []).some((m) => m.eventId === eventFilter)
      );
    }
    if (statusFilter === 'active') {
      list = list.filter((u) => u.is_active !== false);
    } else if (statusFilter === 'inactive') {
      list = list.filter((u) => u.is_active === false);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) => {
        const eventHaystack = (membershipsByUser[u.id] ?? [])
          .map((m) => `${m.eventName} ${m.roleLabel}`)
          .join(' ')
          .toLowerCase();
        return (
          u.email?.toLowerCase().includes(q) ||
          (u.full_name ?? '').toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q) ||
          eventHaystack.includes(q)
        );
      });
    }
    return list;
  }, [rows, search, eventFilter, statusFilter, membershipsByUser]);

  const filterStats = useMemo(() => {
    const active = filtered.filter((u) => u.is_active !== false).length;
    return {
      total: filtered.length,
      active,
      inactive: filtered.length - active,
    };
  }, [filtered]);

  const bulkDeactivateTargets = useMemo(() => {
    if (!eventFilter) return [];
    return filtered.filter(
      (u) =>
        u.is_active !== false &&
        u.id !== currentUserId &&
        !u.is_platform_admin
    );
  }, [filtered, eventFilter, currentUserId]);

  const bulkSkippedAdmins = useMemo(() => {
    if (!eventFilter) return 0;
    return filtered.filter(
      (u) => u.is_active !== false && u.is_platform_admin && u.id !== currentUserId
    ).length;
  }, [filtered, eventFilter, currentUserId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const hasActiveFilters = !!(search.trim() || eventFilter || statusFilter !== 'all');

  useEffect(() => {
    setPage(1);
  }, [search, eventFilter, statusFilter]);

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

  const clearFilters = () => {
    setSearch('');
    setEventFilter('');
    setStatusFilter('all');
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      const auditDetails: Record<string, unknown> = {};
      if (d.full_name !== (u.full_name ?? '')) {
        auditDetails.full_name = { from: u.full_name ?? '', to: fn };
      }
      if (d.is_platform_admin !== (u.is_platform_admin === true)) {
        await logPlatformAudit({
          category: 'admin',
          action: d.is_platform_admin ? 'platform_admin_grant' : 'platform_admin_revoke',
          targetUserId: u.id,
          targetEmail: u.email,
          targetName: fn,
        });
      }
      if (d.is_active !== (u.is_active !== false)) {
        await logPlatformAudit({
          category: 'admin',
          action: d.is_active ? 'account_activate' : 'account_deactivate',
          targetUserId: u.id,
          targetEmail: u.email,
          targetName: fn,
        });
      }
      if (Object.keys(auditDetails).length > 0) {
        await logPlatformAudit({
          category: 'admin',
          action: 'profile_update',
          targetUserId: u.id,
          targetEmail: u.email,
          targetName: fn,
          details: auditDetails,
        });
      }
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

  const handleToggleActive = async (u: UserRow, makeActive: boolean) => {
    if (u.id === currentUserId) return;
    const label = displayName(u);
    const currentlyActive = u.is_active !== false;
    if (makeActive === currentlyActive) return;

    if (!makeActive) {
      let msg = `Deactivate "${label}"?\n\nThey stay in the database but are marked inactive. Use Reactivate user to restore access.`;
      if (u.is_platform_admin) {
        msg += '\n\nThis person is a platform admin — they will lose cadmin access while deactivated.';
      }
      if (!window.confirm(msg)) return;
    } else if (!window.confirm(`Reactivate "${label}"? They will be marked active again.`)) {
      return;
    }

    setError('');
    setToggleActiveId(u.id);
    try {
      const fn = (drafts[u.id]?.full_name ?? u.full_name ?? '').trim() || label;
      const { error: upErr } = await supabase.from('users').update({ is_active: makeActive }).eq('id', u.id);
      if (upErr) throw upErr;
      await logPlatformAudit({
        category: 'admin',
        action: makeActive ? 'account_activate' : 'account_deactivate',
        targetUserId: u.id,
        targetEmail: u.email,
        targetName: fn,
        eventId: eventFilter || undefined,
      });
      setRows((prev) =>
        prev.map((r) => (r.id === u.id ? { ...r, is_active: makeActive } : r))
      );
      setDrafts((prev) => {
        const cur = prev[u.id];
        if (!cur) return prev;
        return { ...prev, [u.id]: { ...cur, is_active: makeActive } };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update account status');
    } finally {
      setToggleActiveId(null);
    }
  };

  const handleBulkDeactivateForEvent = async () => {
    if (!selectedEvent || bulkDeactivateTargets.length === 0) return;
    let msg =
      `Deactivate ${bulkDeactivateTargets.length} active user(s) who belong to "${selectedEvent.name}"?\n\n` +
      'Their accounts stay in the database but are marked inactive. This is logged in the audit timeline.';
    if (bulkSkippedAdmins > 0) {
      msg += `\n\n${bulkSkippedAdmins} platform admin(s) in this list will be skipped.`;
    }
    msg += '\n\nYou cannot undo this in one click — use Reactivate user on each account if needed.';
    if (!window.confirm(msg)) return;

    setError('');
    setBulkDeactivating(true);
    const eventId = selectedEvent.id;
    const eventName = selectedEvent.name;
    let failed = 0;
    const deactivatedIds = new Set<string>();

    try {
      for (const u of bulkDeactivateTargets) {
        const fn = (drafts[u.id]?.full_name ?? u.full_name ?? '').trim() || u.email;
        const { error: upErr } = await supabase.from('users').update({ is_active: false }).eq('id', u.id);
        if (upErr) {
          failed += 1;
          continue;
        }
        await logPlatformAudit({
          category: 'admin',
          action: 'account_deactivate',
          targetUserId: u.id,
          targetEmail: u.email,
          targetName: fn,
          eventId,
          details: { bulk_event_deactivate: true, event_name: eventName },
        });
        deactivatedIds.add(u.id);
      }

      setRows((prev) =>
        prev.map((r) => (deactivatedIds.has(r.id) ? { ...r, is_active: false } : r))
      );
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of deactivatedIds) {
          const cur = next[id];
          if (cur) next[id] = { ...cur, is_active: false };
        }
        return next;
      });

      if (failed > 0) {
        setError(`${deactivatedIds.size} deactivated, but ${failed} failed. Try again for the rest.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk deactivation failed');
    } finally {
      setBulkDeactivating(false);
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (u.id === currentUserId) return;
    const ok = window.confirm(
      `Permanently delete "${displayName(u)}"? All their data (posts, memberships, messages, etc.) will be removed. This cannot be undone.`
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
      setMembershipsByUser((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
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
          Find users by event, name, or email. Use <strong>Deactivate</strong> to block access without deleting data.
          Review suspicious accounts on the <Link to="/platform/audit">Security audit</Link> page first if needed.
        </p>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {membershipsError ? (
        <div className={styles.error}>{`Could not load event memberships: ${membershipsError}`}</div>
      ) : null}

      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{rows.length}</span>
          <span className={styles.statLabel}>Total users</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{filterStats.total}</span>
          <span className={styles.statLabel}>Matching filters</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${styles.statActive}`}>{filterStats.active}</span>
          <span className={styles.statLabel}>Active</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${styles.statInactive}`}>{filterStats.inactive}</span>
          <span className={styles.statLabel}>Deactivated</span>
        </div>
      </div>

      <h2 ref={listTopRef} className={styles.listTitle}>
        User list
      </h2>

      <div className={styles.filterBar}>
        <div className={styles.filterField}>
          <label htmlFor="platform-users-event" className={styles.searchLabel}>
            Filter by event
          </label>
          <select
            id="platform-users-event"
            className={styles.select}
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <option value="">All events</option>
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.memberCount} members)
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="platform-users-status" className={styles.searchLabel}>
            Account status
          </label>
          <select
            id="platform-users-status"
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Deactivated only</option>
          </select>
        </div>
        <div className={`${styles.filterField} ${styles.filterFieldGrow}`}>
          <label htmlFor="platform-users-search" className={styles.searchLabel}>
            Search
          </label>
          <input
            id="platform-users-search"
            type="search"
            className={styles.search}
            placeholder="Email, name, or user id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
        {hasActiveFilters ? (
          <div className={styles.filterActions}>
            <button type="button" className={styles.clearBtn} onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}
      </div>

      {selectedEvent ? (
        <div className={styles.eventBulkBar}>
          <div className={styles.eventBulkText}>
            <strong>{selectedEvent.name}</strong>
            <span>
              {selectedEvent.memberCount} member{selectedEvent.memberCount === 1 ? '' : 's'} ·{' '}
              {filterStats.active} active in current view
            </span>
            {bulkSkippedAdmins > 0 ? (
              <span className={styles.eventBulkNote}>
                Platform admins are excluded from bulk deactivation ({bulkSkippedAdmins} in list).
              </span>
            ) : null}
          </div>
          <div className={styles.eventBulkActions}>
            <Link to={`/events/${selectedEvent.id}`} className={styles.eventBulkLink}>
              Open event
            </Link>
            <button
              type="button"
              className={styles.deactivateBtn}
              disabled={bulkDeactivating || bulkDeactivateTargets.length === 0}
              onClick={handleBulkDeactivateForEvent}
            >
              {bulkDeactivating
                ? 'Deactivating…'
                : `Deactivate all active (${bulkDeactivateTargets.length})`}
            </button>
          </div>
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <p className={styles.searchMeta}>
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of{' '}
          {filtered.length}
          {rows.length !== filtered.length ? ` (from ${rows.length} total)` : ''}
          {totalPages > 1 ? ` · Page ${page} / ${totalPages}` : ''}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className={styles.empty}>No users in the database.</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No users match your filters. Try clearing filters or choosing a different event.</p>
      ) : (
        <>
          <ul className={styles.list}>
            {paginated.map((u) => {
              const d = drafts[u.id];
              const self = u.id === currentUserId;
              const eventsForUser = membershipsByUser[u.id] ?? [];
              const expanded = expandedIds.has(u.id);
              const inactive = u.is_active === false;
              return (
                <li
                  key={u.id}
                  className={`${styles.item} ${inactive ? styles.itemInactive : ''}`}
                >
                  <div className={styles.itemHead}>
                    <div className={styles.itemIdentity}>
                      <span className={styles.displayName}>{displayName(u)}</span>
                      <span className={styles.email}>{u.email}</span>
                    </div>
                    <div className={styles.badges}>
                      {u.is_platform_admin ? <span className={styles.badge}>Platform admin</span> : null}
                      {inactive ? (
                        <span className={styles.badgeInactive}>Deactivated</span>
                      ) : (
                        <span className={styles.badgeActive}>Active</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.eventMemberships}>
                    <span className={styles.eventMembershipsLabel}>Events</span>
                    {eventsForUser.length === 0 ? (
                      <span className={styles.eventMembershipsNone}>None — orphan account</span>
                    ) : (
                      <ul className={styles.eventMembershipsList}>
                        {eventsForUser.map((m) => (
                          <li key={`${u.id}-${m.eventId}`}>
                            <Link to={`/events/${m.eventId}`} className={styles.eventLink}>
                              {m.eventName}
                            </Link>
                            <span className={styles.eventRoleMuted}> · {m.roleLabel}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {expanded && d ? (
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
                      <details className={styles.passwordDetails}>
                        <summary className={styles.passwordSummary}>Reset password (optional)</summary>
                        <div className={styles.passwordBlock}>
                          <p className={styles.passwordHint}>
                            Applies immediately; user is prompted to change on next login.
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
                      </details>
                    </div>
                  ) : null}

                  {self ? (
                    <p className={styles.selfNote}>
                      You cannot deactivate or remove your own platform admin flag here.
                    </p>
                  ) : null}

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => toggleExpanded(u.id)}
                    >
                      {expanded ? 'Hide editing' : 'Edit profile'}
                    </button>
                    {expanded ? (
                      <button
                        type="button"
                        className={styles.saveBtn}
                        disabled={!isDirty(u) || savingId === u.id}
                        onClick={() => handleSave(u)}
                      >
                        {savingId === u.id ? 'Saving…' : 'Save changes'}
                      </button>
                    ) : null}
                    {!inactive ? (
                      <button
                        type="button"
                        className={styles.deactivateBtn}
                        disabled={self || toggleActiveId === u.id || deletingId === u.id}
                        onClick={() => handleToggleActive(u, false)}
                      >
                        {toggleActiveId === u.id ? 'Deactivating…' : 'Deactivate'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.reactivateBtn}
                        disabled={self || toggleActiveId === u.id || deletingId === u.id}
                        onClick={() => handleToggleActive(u, true)}
                      >
                        {toggleActiveId === u.id ? 'Reactivating…' : 'Reactivate'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      disabled={self || deletingId === u.id}
                      onClick={() => handleDelete(u)}
                    >
                      {deletingId === u.id ? 'Deleting…' : 'Delete'}
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
