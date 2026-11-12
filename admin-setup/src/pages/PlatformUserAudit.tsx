import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase, supabaseUrl } from '../lib/supabase';
import { deletePlatformUser } from '../lib/deletePlatformUser';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { logPlatformAudit } from '../lib/logPlatformAudit';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import { setAccountActive } from '../lib/setAccountActive';
import styles from './PlatformUserAudit.module.css';

type AuditRow = {
  id: string;
  created_at: string;
  category: string;
  action: string;
  target_user_id: string | null;
  target_email: string | null;
  target_name: string | null;
  event_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  actor: { user_id: string; full_name: string; email: string } | null;
};

type OrphanAccount = {
  user_id: string;
  email: string;
  full_name: string;
  created_at: string | null;
  last_login_at: string | null;
  is_platform_admin: boolean;
  is_active: boolean;
};

type OverviewCounts = {
  total_users: number;
  platform_admins: number;
  inactive_users: number;
  orphan_accounts: number;
  open_reports: number;
  audit_events_7d: number;
  failed_logins_7d: number;
  brute_force_alerts_24h: number;
  safety_repeat_offenders: number;
  suspicious_users: number;
  total_blocks: number;
};

type TileKey =
  | 'total_users'
  | 'orphan_accounts'
  | 'platform_admins'
  | 'inactive_users'
  | 'open_reports'
  | 'audit_events_7d'
  | 'failed_logins_7d'
  | 'brute_force_alerts_24h'
  | 'safety_repeat_offenders'
  | 'suspicious_users'
  | 'total_blocks';

type UserStatusFilter = 'all' | 'active' | 'inactive';

type BruteForcePack = {
  hours?: number;
  email_targets?: Record<string, unknown>[];
  ip_targets?: Record<string, unknown>[];
  ip_scans?: Record<string, unknown>[];
  alert_count_24h?: number;
};

type SafetyOverview = {
  counts?: {
    total_reports?: number;
    reports_7d?: number;
    total_blocks?: number;
    blocks_7d?: number;
    repeat_offenders?: number;
  };
  reports?: Record<string, unknown>[];
  blocks?: Record<string, unknown>[];
  repeat_offenders?: Record<string, unknown>[];
};

type SuspiciousUser = {
  user_id: string;
  email: string;
  full_name: string;
  score: number;
  signals: string[];
  report_count: number;
  block_count: number;
  failed_logins_7d: number;
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
};

type ReviewedAccount = {
  user_id: string;
  email: string;
  full_name: string;
  is_recognized: boolean;
  risk_cleared_at: string | null;
  note: string | null;
  reviewed_at: string;
  reviewed_by_email: string | null;
};

type AuditUserTarget = {
  user_id: string;
  email: string;
  full_name: string;
  is_active?: boolean;
};

async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function auditUserLabel(u: AuditUserTarget): string {
  return u.full_name?.trim() || u.email;
}

type TileConfig = {
  key: TileKey;
  label: string;
  countKey: keyof OverviewCounts;
};

const TILES: TileConfig[] = [
  { key: 'total_users', label: 'Total accounts', countKey: 'total_users' },
  { key: 'orphan_accounts', label: 'No event membership', countKey: 'orphan_accounts' },
  { key: 'suspicious_users', label: 'Accounts needing review', countKey: 'suspicious_users' },
  { key: 'platform_admins', label: 'Platform admins', countKey: 'platform_admins' },
  { key: 'inactive_users', label: 'Deactivated', countKey: 'inactive_users' },
  { key: 'open_reports', label: 'User reports (all time)', countKey: 'open_reports' },
  { key: 'safety_repeat_offenders', label: 'Repeat offenders', countKey: 'safety_repeat_offenders' },
  { key: 'total_blocks', label: 'User blocks', countKey: 'total_blocks' },
  { key: 'failed_logins_7d', label: 'Failed logins (7 days)', countKey: 'failed_logins_7d' },
  { key: 'brute_force_alerts_24h', label: 'Brute-force alerts (24h)', countKey: 'brute_force_alerts_24h' },
  { key: 'audit_events_7d', label: 'Audit events (7 days)', countKey: 'audit_events_7d' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'auth', label: 'Auth' },
  { value: 'admin', label: 'Admin actions' },
  { value: 'security', label: 'Security' },
];

const ACTION_LABELS: Record<string, string> = {
  signup: 'Account created',
  login_success: 'Login succeeded',
  login_failed: 'Login failed',
  user_delete: 'Account deleted',
  account_self_delete: 'Self-deleted account',
  password_reset: 'Password reset (admin)',
  email_change: 'Email changed (admin)',
  profile_update: 'Profile updated',
  platform_admin_grant: 'Platform admin granted',
  platform_admin_revoke: 'Platform admin revoked',
  account_deactivate: 'Account deactivated',
  account_activate: 'Account reactivated',
  account_recognized: 'Account recognized',
  account_risk_cleared: 'Security review cleared',
  account_review_reset: 'Account review reset',
  user_report: 'User reported',
  orphan_signup_alert: 'No-event membership alert sent',
  brute_force_email: 'Brute-force on email',
  brute_force_ip: 'Brute-force from IP',
  ip_scan: 'Credential scanning',
};

const TILE_COLUMN_LABELS: Record<string, string> = {
  email: 'Email',
  full_name: 'Name',
  created_at: 'Signed up',
  last_login_at: 'Last login',
  is_active: 'Active',
  is_platform_admin: 'Platform admin',
  has_event_membership: 'On event',
  user_id: 'User ID',
  reason: 'Reason',
  details: 'Details',
  reporter_email: 'Reporter',
  reporter_name: 'Reporter name',
  reported_email: 'Reported user',
  reported_name: 'Reported name',
  category: 'Category',
  action: 'Action',
  target_email: 'Target email',
  target_name: 'Target name',
  actor_email: 'By (email)',
  actor_name: 'By (name)',
  ip_address: 'IP',
  report_id: 'Report ID',
  score: 'Risk score',
  signals: 'Signals',
  report_count: 'Reports',
  block_count: 'Blocks',
  failed_logins_7d: 'Failed logins (7d)',
  event_name: 'Event',
  alert_type: 'Alert type',
  dedupe_key: 'Key',
  sent_at: 'Sent',
  blocker_email: 'Blocker',
  blocked_email: 'Blocked user',
  distinct_emails: 'Distinct emails',
  attempt_count: 'Attempts',
  reasons: 'Reasons',
};

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

function signalLabel(signal: string): string {
  if (signal === 'orphan_account') return 'No event membership';
  if (signal === 'orphan_recent_login') return 'Recent login with no event';
  if (signal === 'many_failed_logins') return 'Many failed logins (7 days)';
  if (signal === 'deactivated_login_attempts') return 'Login attempts while deactivated';
  const reported = /^reported_(\d+)_times$/.exec(signal);
  if (reported) {
    const n = Number(reported[1]);
    return n === 1 ? 'Reported 1 time' : `Reported ${n} times`;
  }
  const blocked = /^blocked_by_(\d+)_users$/.exec(signal);
  if (blocked) {
    const n = Number(blocked[1]);
    return n === 1 ? 'Blocked by 1 user' : `Blocked by ${n} users`;
  }
  return signal.replace(/_/g, ' ');
}

function formatSignals(signals: string[] | null | undefined): string {
  if (!signals?.length) return '—';
  return signals.map(signalLabel).join(', ');
}

/** Plain-language line for platform admins (not raw JSON). */
function auditPlainSummary(row: AuditRow): string {
  const d = row.details ?? {};
  if (typeof d.summary === 'string' && d.summary.trim()) return d.summary.trim();
  if (typeof d.body === 'string' && d.body.trim()) return d.body.trim();

  switch (row.action) {
    case 'ip_scan':
      return typeof d.distinct_emails === 'number'
        ? `One internet address tried ${d.distinct_emails} different login emails in 15 minutes — possible account probing.`
        : 'One internet address tried many different login emails — possible account probing.';
    case 'brute_force_ip':
      return typeof d.attempt_count === 'number'
        ? `Many failed login attempts (${d.attempt_count}) from one internet address in 15 minutes.`
        : 'Many failed login attempts from one internet address in 15 minutes.';
    case 'brute_force_email':
      return typeof d.attempt_count === 'number'
        ? `Many failed login attempts (${d.attempt_count}) against one email in 15 minutes.`
        : 'Many failed login attempts against one email in 15 minutes.';
    case 'login_failed':
      return row.target_email
        ? `Wrong password or unknown account for ${row.target_email}.`
        : 'A login attempt failed (wrong password or unknown account).';
    case 'login_success':
      return row.target_email
        ? `${row.target_email} signed in successfully.`
        : 'Someone signed in successfully.';
    case 'signup':
      return row.target_email
        ? `New account created: ${row.target_email}.`
        : 'A new account was created.';
    case 'orphan_signup_alert':
      return 'Email alert sent: account with no event membership.';
    case 'account_deactivate':
      if (d.source === 'auto_orphan_policy') {
        return typeof d.summary === 'string' && d.summary.trim()
          ? d.summary.trim()
          : 'Automated deactivation: orphan account matched the security policy.';
      }
      return row.target_email
        ? `Account deactivated: ${row.target_email}.`
        : 'An account was deactivated.';
    case 'user_delete':
    case 'account_self_delete':
      return row.target_email
        ? `Account removed: ${row.target_email}.`
        : 'An account was removed.';
    case 'password_reset':
      return row.target_email
        ? `Password was reset for ${row.target_email}.`
        : 'An admin reset a user password.';
    default:
      if (row.category === 'security') {
        return typeof d.title === 'string' ? String(d.title) : 'Automated security alert.';
      }
      return actionLabel(row.action);
  }
}

function auditTargetLabel(row: AuditRow): string {
  if (row.target_email) return row.target_email;
  if (row.target_name) return row.target_name;
  if (row.target_user_id) return row.target_user_id;
  const ip = row.ip_address || (typeof row.details?.ip_address === 'string' ? row.details.ip_address : null);
  if (ip) return `IP ${ip}`;
  if (typeof row.details?.email === 'string') return row.details.email;
  return '—';
}

function auditActorLabel(row: AuditRow): { primary: string; hint?: string } {
  if (row.actor?.full_name || row.actor?.email) {
    return { primary: row.actor.full_name || row.actor.email };
  }
  if (row.category === 'security') {
    return {
      primary: 'Automated monitor',
      hint: 'Not a person — the platform detected a suspicious pattern and logged it.',
    };
  }
  if (
    row.category === 'admin'
    && row.action === 'account_deactivate'
    && row.details?.source === 'auto_orphan_policy'
  ) {
    return {
      primary: 'Automated policy',
      hint: 'No event membership + age threshold + (no portal submission or failed logins).',
    };
  }
  if (row.category === 'auth' && row.action === 'signup') {
    return { primary: 'Self signup', hint: 'The user created their own account.' };
  }
  return { primary: 'System', hint: 'Automatic platform process.' };
}

function detailSummary(details: Record<string, unknown>) {
  const keys = Object.keys(details ?? {});
  if (keys.length === 0) return '';
  if (keys.length === 1 && keys[0] === 'source') return '';
  try {
    return JSON.stringify(details);
  } catch {
    return '';
  }
}

function formatCell(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'signals' && Array.isArray(value)) {
    return formatSignals(value.map((item) => String(item)));
  }
  if (key.endsWith('_at') && typeof value === 'string') return formatWhen(value);
  if (key === 'action' && typeof value === 'string') return actionLabel(value);
  if (key === 'details' && typeof value === 'object') return detailSummary(value as Record<string, unknown>) || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function columnsForTile(tile: TileKey, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return [];
  const preferred: Record<TileKey, string[]> = {
    total_users: ['email', 'full_name', 'created_at', 'last_login_at', 'has_event_membership', 'is_active'],
    orphan_accounts: ['email', 'full_name', 'created_at', 'last_login_at', 'is_active'],
    platform_admins: ['email', 'full_name', 'last_login_at', 'created_at'],
    inactive_users: ['email', 'full_name', 'created_at', 'last_login_at', 'is_active'],
    open_reports: ['created_at', 'reason', 'reporter_email', 'reported_email', 'details'],
    audit_events_7d: ['created_at', 'category', 'action', 'target_email', 'actor_email', 'details'],
    failed_logins_7d: ['created_at', 'target_email', 'ip_address', 'details'],
    brute_force_alerts_24h: ['sent_at', 'alert_type', 'details', 'dedupe_key'],
    safety_repeat_offenders: ['email', 'full_name', 'report_count', 'last_report_at', 'reasons'],
    suspicious_users: ['score', 'email', 'full_name', 'signals', 'report_count', 'block_count', 'failed_logins_7d', 'last_login_at'],
    total_blocks: ['created_at', 'blocker_email', 'blocked_email'],
  };
  const pref = preferred[tile];
  return pref.filter((k) => k in rows[0]!);
}

export default function PlatformUserAudit() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [orphans, setOrphans] = useState<OrphanAccount[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [selectedTile, setSelectedTile] = useState<TileKey | null>(null);
  const [tileTitle, setTileTitle] = useState('');
  const [tileRows, setTileRows] = useState<Record<string, unknown>[]>([]);
  const [tileLoading, setTileLoading] = useState(false);
  const [tileSearch, setTileSearch] = useState('');
  const [tileStatus, setTileStatus] = useState<UserStatusFilter>('all');
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [bruteForce, setBruteForce] = useState<BruteForcePack | null>(null);
  const [safety, setSafety] = useState<SafetyOverview | null>(null);
  const [suspicious, setSuspicious] = useState<SuspiciousUser[]>([]);
  const [reviewedAccounts, setReviewedAccounts] = useState<ReviewedAccount[]>([]);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(() => new Set());
  const [selectedSuspiciousIds, setSelectedSuspiciousIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [safetyBusyId, setSafetyBusyId] = useState<string | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    isCurrentUserPlatformAdmin().then(setAllowed);
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [overviewRes, auditRes, bruteRes, safetyRes, accountReviewRes] = await Promise.all([
        supabase.rpc('get_platform_security_overview'),
        supabase.rpc('list_platform_user_audit', {
          p_limit: pageSize,
          p_offset: (page - 1) * pageSize,
          p_category: category || null,
          p_action: null,
          p_search: search.trim() || null,
        }),
        supabase.rpc('list_brute_force_anomalies', { p_hours: 24 }),
        supabase.rpc('list_platform_safety_overview', { p_limit: 50 }),
        supabase.rpc('list_platform_account_reviews', { p_limit: 50, p_min_score: 20 }),
      ]);

      if (overviewRes.error) throw overviewRes.error;
      const overview = overviewRes.data as {
        error?: string;
        counts?: OverviewCounts;
        orphan_accounts?: OrphanAccount[];
      } | null;
      if (overview?.error) throw new Error(overview.error);
      const overviewCounts = overview?.counts ?? null;

      if (auditRes.error) throw auditRes.error;
      const audit = auditRes.data as {
        error?: string;
        rows?: AuditRow[];
        total?: number;
      } | null;
      if (audit?.error) throw new Error(audit.error);
      setRows(Array.isArray(audit?.rows) ? audit!.rows! : []);
      setTotal(typeof audit?.total === 'number' ? audit.total : 0);

      if (bruteRes.error) throw bruteRes.error;
      const brute = bruteRes.data as BruteForcePack & { error?: string } | null;
      if (brute?.error) throw new Error(brute.error);
      setBruteForce(brute);

      if (safetyRes.error) throw safetyRes.error;
      const safetyPack = safetyRes.data as SafetyOverview & { error?: string } | null;
      if (safetyPack?.error) throw new Error(safetyPack.error);
      setSafety(safetyPack);

      if (accountReviewRes.error) throw accountReviewRes.error;
      const reviewPack = accountReviewRes.data as {
        error?: string;
        suspicious_count?: number;
        orphan_count?: number;
        suspicious_rows?: SuspiciousUser[];
        orphan_rows?: OrphanAccount[];
        reviewed_rows?: ReviewedAccount[];
      } | null;
      if (reviewPack?.error) throw new Error(reviewPack.error);
      setCounts(
        overviewCounts
          ? {
              ...overviewCounts,
              suspicious_users: reviewPack?.suspicious_count ?? 0,
              orphan_accounts: reviewPack?.orphan_count ?? 0,
            }
          : null
      );
      setSuspicious(Array.isArray(reviewPack?.suspicious_rows) ? reviewPack.suspicious_rows : []);
      setOrphans(Array.isArray(reviewPack?.orphan_rows) ? reviewPack.orphan_rows : []);
      setReviewedAccounts(Array.isArray(reviewPack?.reviewed_rows) ? reviewPack.reviewed_rows : []);
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setRows([]);
      setOrphans([]);
      setBruteForce(null);
      setSafety(null);
      setSuspicious([]);
      setReviewedAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [category, page, search]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const openTile = useCallback(async (tile: TileKey, status: UserStatusFilter = 'all') => {
    setSelectedTile(tile);
    setTileLoading(true);
    setTileRows([]);
    setTileTitle('');
    setTileSearch('');
    setTileStatus(status);
    try {
      if (tile === 'suspicious_users') {
        setTileTitle('Accounts needing review');
        setTileRows(suspicious as unknown as Record<string, unknown>[]);
        return;
      }
      if (tile === 'orphan_accounts') {
        setTileTitle('Unrecognized accounts');
        setTileRows(orphans as unknown as Record<string, unknown>[]);
        return;
      }
      const { data, error: rpcErr } = await supabase.rpc('get_platform_audit_tile_detail', {
        p_tile: tile,
        p_limit: 200,
      });
      if (rpcErr) throw rpcErr;
      const pack = data as { error?: string; title?: string; rows?: Record<string, unknown>[] } | null;
      if (pack?.error) throw new Error(pack.error);
      setTileTitle(pack?.title ?? tile);
      setTileRows(Array.isArray(pack?.rows) ? pack!.rows! : []);
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setSelectedTile(null);
    } finally {
      setTileLoading(false);
    }
  }, [orphans, suspicious]);

  const closeTile = () => {
    setSelectedTile(null);
    setTileRows([]);
    setTileTitle('');
    setTileSearch('');
    setTileStatus('all');
  };

  const removeUserFromLists = (userId: string) => {
    setSuspicious((prev) => prev.filter((u) => u.user_id !== userId));
    setOrphans((prev) => prev.filter((u) => u.user_id !== userId));
    setSelectedOrphanIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    setSelectedSuspiciousIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  const deactivateUserCore = async (u: AuditUserTarget) => {
    const label = auditUserLabel(u);
    await setAccountActive({ userId: u.user_id, isActive: false });
    await logPlatformAudit({
      category: 'admin',
      action: 'account_deactivate',
      targetUserId: u.user_id,
      targetEmail: u.email,
      targetName: label,
    });
    setSuspicious((prev) =>
      prev.map((row) => (row.user_id === u.user_id ? { ...row, is_active: false } : row))
    );
    setOrphans((prev) =>
      prev.map((row) => (row.user_id === u.user_id ? { ...row, is_active: false } : row))
    );
    setTileRows((prev) =>
      prev.map((row) => (String(row.user_id ?? '') === u.user_id ? { ...row, is_active: false } : row))
    );
    setCounts((prev) =>
      prev ? { ...prev, inactive_users: prev.inactive_users + 1 } : prev
    );
  };

  const deleteUserCore = async (u: AuditUserTarget) => {
    await refreshSupabaseSessionIfNeeded();
    const token = await getEdgeFunctionAccessToken();
    if (!token || !supabaseUrl) throw new Error('Not signed in or missing Supabase URL.');
    await deletePlatformUser(token, u.user_id);
    removeUserFromLists(u.user_id);
  };

  const handleDeactivateUser = async (u: AuditUserTarget) => {
    if (u.user_id === currentUserId) return;
    if (u.is_active === false) return;
    const label = auditUserLabel(u);
    if (
      !window.confirm(
        `Deactivate "${label}"?\n\nThey stay in the database but cannot sign in. Use All users to reactivate if needed.`
      )
    ) {
      return;
    }
    setError('');
    setNotice('');
    setDeactivatingId(u.user_id);
    try {
      await deactivateUserCore(u);
      setNotice(`${label} was deactivated and can no longer sign in.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not deactivate account');
    } finally {
      setDeactivatingId(null);
    }
  };

  const handleReactivateUser = async (u: AuditUserTarget) => {
    if (u.user_id === currentUserId || u.is_active !== false) return;
    const label = auditUserLabel(u);
    if (!window.confirm(`Reactivate "${label}"?\n\nThey will be able to sign in again.`)) return;
    setError('');
    setNotice('');
    setActivatingId(u.user_id);
    try {
      await setAccountActive({ userId: u.user_id, isActive: true });
      setSuspicious((prev) =>
        prev.map((row) => (row.user_id === u.user_id ? { ...row, is_active: true } : row))
      );
      setOrphans((prev) =>
        prev.map((row) => (row.user_id === u.user_id ? { ...row, is_active: true } : row))
      );
      setTileRows((prev) =>
        prev.map((row) => (String(row.user_id ?? '') === u.user_id ? { ...row, is_active: true } : row))
      );
      setCounts((prev) =>
        prev ? { ...prev, inactive_users: Math.max(0, prev.inactive_users - 1) } : prev
      );
      setNotice(`${label} was reactivated and can sign in again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reactivate account');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeleteUser = async (u: AuditUserTarget) => {
    if (u.user_id === currentUserId) return;
    const label = auditUserLabel(u);
    if (
      !window.confirm(
        `Permanently delete "${label}"?\n\nAll their data (auth account, profile, posts, memberships, messages, etc.) will be removed. This cannot be undone.`
      )
    ) {
      return;
    }
    setError('');
    setDeletingId(u.user_id);
    try {
      await deleteUserCore(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleIdInSet = (
    setter: (fn: (prev: Set<string>) => Set<string>) => void,
    id: string
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkOnUsers = async (
    targets: AuditUserTarget[],
    mode: 'deactivate' | 'delete'
  ) => {
    const list = targets.filter((u) => u.user_id !== currentUserId);
    if (list.length === 0) {
      setError('No eligible accounts selected (you cannot act on your own account).');
      return;
    }
    if (mode === 'deactivate') {
      const active = list.filter((u) => u.is_active !== false);
      if (active.length === 0) {
        setError('Selected accounts are already deactivated.');
        return;
      }
      if (
        !window.confirm(
          `Deactivate ${active.length} account(s)?\n\nThey stay in the system but cannot sign in. You can reactivate later from All users.`
        )
      ) {
        return;
      }
      setBulkBusy(true);
      setError('');
      let ok = 0;
      const failures: string[] = [];
      for (const u of active) {
        try {
          await deactivateUserCore(u);
          ok += 1;
        } catch (e) {
          failures.push(`${u.email}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setBulkBusy(false);
      setSelectedOrphanIds(new Set());
      setSelectedSuspiciousIds(new Set());
      if (failures.length) {
        setError(`Deactivated ${ok}. Failed: ${failures.slice(0, 3).join('; ')}`);
      }
      return;
    }

    if (
      !window.confirm(
        `Permanently delete ${list.length} account(s)?\n\nThis removes their login and related data. This cannot be undone.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError('');
    let ok = 0;
    const failures: string[] = [];
    for (const u of list) {
      try {
        await deleteUserCore(u);
        ok += 1;
      } catch (e) {
        failures.push(`${u.email}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    setBulkBusy(false);
    setSelectedOrphanIds(new Set());
    setSelectedSuspiciousIds(new Set());
    if (failures.length) {
      setError(`Deleted ${ok}. Failed: ${failures.slice(0, 3).join('; ')}`);
    }
  };

  const handleClearReport = async (reportId: string, label: string) => {
    if (
      !window.confirm(
        `Clear this report${label ? ` (${label})` : ''}?\n\nRemoves it from the list permanently. Use this for test or mistaken reports.`
      )
    ) {
      return;
    }
    setError('');
    setSafetyBusyId(reportId);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_clear_user_report', {
        p_report_id: reportId,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string; reported_user_id?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not clear report');
      await logPlatformAudit({
        category: 'admin',
        action: 'report_clear',
        targetUserId: body.reported_user_id ?? null,
        details: { report_id: reportId },
      });
      setSafety((prev) =>
        prev
          ? {
              ...prev,
              reports: (prev.reports ?? []).filter((r) => String(r.report_id) !== reportId),
              counts: prev.counts
                ? {
                    ...prev.counts,
                    total_reports: Math.max(0, (prev.counts.total_reports ?? 1) - 1),
                  }
                : prev.counts,
            }
          : prev
      );
      setCounts((prev) =>
        prev
          ? { ...prev, open_reports: Math.max(0, (prev.open_reports ?? 1) - 1) }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear report');
    } finally {
      setSafetyBusyId(null);
    }
  };

  const handleClearAllShownReports = async () => {
    const ids = (safety?.reports ?? [])
      .map((r) => String(r.report_id ?? ''))
      .filter(Boolean);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Clear all ${ids.length} report(s) shown below?\n\nThis permanently removes them (good for wiping test data).`
      )
    ) {
      return;
    }
    setError('');
    setBulkBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_clear_user_reports', {
        p_report_ids: ids,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; cleared?: number; failed?: number; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not clear reports');
      await logPlatformAudit({
        category: 'admin',
        action: 'report_clear_bulk',
        details: { cleared: body.cleared ?? ids.length, report_ids: ids },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear reports');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleUnblock = async (blockId: string, label: string) => {
    if (
      !window.confirm(
        `Unblock${label ? ` ${label}` : ''}?\n\nThey will be able to message / see each other again in the app.`
      )
    ) {
      return;
    }
    setError('');
    setSafetyBusyId(blockId);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_remove_user_block', {
        p_block_id: blockId,
      });
      if (rpcErr) throw rpcErr;
      const body = data as {
        ok?: boolean;
        error?: string;
        blocked_user_id?: string;
        blocker_id?: string;
      } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not unblock');
      await logPlatformAudit({
        category: 'admin',
        action: 'user_unblock',
        targetUserId: body.blocked_user_id ?? null,
        details: { block_id: blockId, blocker_id: body.blocker_id },
      });
      setSafety((prev) =>
        prev
          ? {
              ...prev,
              blocks: (prev.blocks ?? []).filter((b) => String(b.block_id) !== blockId),
              counts: prev.counts
                ? {
                    ...prev.counts,
                    total_blocks: Math.max(0, (prev.counts.total_blocks ?? 1) - 1),
                  }
                : prev.counts,
            }
          : prev
      );
      setCounts((prev) =>
        prev ? { ...prev, total_blocks: Math.max(0, (prev.total_blocks ?? 1) - 1) } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unblock');
    } finally {
      setSafetyBusyId(null);
    }
  };

  const handleDeactivateAllActiveOrphans = async () => {
    const targets = orphans.filter(
      (o) => o.is_active !== false && !o.is_platform_admin && o.user_id !== currentUserId
    );
    if (targets.length === 0) {
      setError('No active unrecognized accounts to deactivate.');
      return;
    }
    await runBulkOnUsers(targets, 'deactivate');
  };

  const handleAccountReview = async (
    u: AuditUserTarget,
    action: 'recognize' | 'clear_risk'
  ) => {
    const promptText =
      action === 'recognize'
        ? 'Optional note: how do you recognize this account?'
        : 'Optional review note: why is this account not suspicious?';
    const note = window.prompt(promptText, '');
    if (note === null) return;

    setError('');
    setNotice('');
    setReviewBusyId(u.user_id);
    try {
      const { data, error: rpcErr } = await supabase.rpc('set_platform_account_review', {
        p_user_id: u.user_id,
        p_action: action,
        p_note: note.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not save the account review');
      await logPlatformAudit({
        category: 'security',
        action: action === 'recognize' ? 'account_recognized' : 'account_risk_cleared',
        targetUserId: u.user_id,
        targetEmail: u.email,
        targetName: auditUserLabel(u),
        details: { note: note.trim() || null },
      });
      setNotice(
        action === 'recognize'
          ? `${auditUserLabel(u)} is now recognized. New security signals will still be monitored.`
          : `${auditUserLabel(u)} was cleared from the current review queue. New signals can flag the account again.`
      );
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setReviewBusyId(null);
    }
  };

  const runBulkAccountReview = async (
    targets: AuditUserTarget[],
    action: 'recognize' | 'clear_risk'
  ) => {
    const list = targets.filter((u) => u.user_id !== currentUserId);
    if (list.length === 0) {
      setError('No eligible accounts selected.');
      return;
    }
    const promptText =
      action === 'recognize'
        ? `Optional note for recognizing ${list.length} account(s):`
        : `Optional note for clearing ${list.length} account(s) from review:`;
    const note = window.prompt(promptText, '');
    if (note === null) return;
    if (
      !window.confirm(
        action === 'recognize'
          ? `Mark ${list.length} account(s) as recognized?\n\nThey leave the unrecognized list. New security signals can still flag them later.`
          : `Mark ${list.length} account(s) as not suspicious?\n\nThey leave the current review queue. New reports, blocks, or failed logins can flag them again.`
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setError('');
    setNotice('');
    let ok = 0;
    const failures: string[] = [];
    for (const u of list) {
      try {
        const { data, error: rpcErr } = await supabase.rpc('set_platform_account_review', {
          p_user_id: u.user_id,
          p_action: action,
          p_note: note.trim() || null,
        });
        if (rpcErr) throw rpcErr;
        const body = data as { ok?: boolean; error?: string } | null;
        if (!body?.ok) throw new Error(body?.error || 'Could not save the account review');
        await logPlatformAudit({
          category: 'security',
          action: action === 'recognize' ? 'account_recognized' : 'account_risk_cleared',
          targetUserId: u.user_id,
          targetEmail: u.email,
          targetName: auditUserLabel(u),
          details: { note: note.trim() || null, bulk: true },
        });
        ok += 1;
      } catch (e) {
        failures.push(`${u.email}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    setBulkBusy(false);
    setSelectedOrphanIds(new Set());
    setSelectedSuspiciousIds(new Set());
    if (failures.length) {
      setError(
        `${action === 'recognize' ? 'Recognized' : 'Cleared'} ${ok}. Failed: ${failures.slice(0, 3).join('; ')}`
      );
    } else {
      setNotice(
        action === 'recognize'
          ? `Recognized ${ok} account(s).`
          : `Cleared ${ok} account(s) from the review queue.`
      );
    }
    await load();
  };

  const handleResetAccountReview = async (u: ReviewedAccount) => {
    if (
      !window.confirm(
        `Undo the trusted/reviewed status for ${auditUserLabel(u)}?\n\nThe account will return to normal risk scoring.`
      )
    ) {
      return;
    }
    setError('');
    setNotice('');
    setReviewBusyId(u.user_id);
    try {
      const { data, error: rpcErr } = await supabase.rpc('clear_platform_account_review', {
        p_user_id: u.user_id,
      });
      if (rpcErr) throw rpcErr;
      const body = data as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new Error(body?.error || 'Could not reset the account review');
      await logPlatformAudit({
        category: 'security',
        action: 'account_review_reset',
        targetUserId: u.user_id,
        targetEmail: u.email,
        targetName: auditUserLabel(u),
      });
      setNotice(`${auditUserLabel(u)} has returned to normal security monitoring.`);
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setReviewBusyId(null);
    }
  };

  const renderUserActions = (u: AuditUserTarget) => {
    const self = u.user_id === currentUserId;
    const busy =
      deactivatingId === u.user_id || deletingId === u.user_id || activatingId === u.user_id;
    return (
      <div className={styles.actionCell}>
        {u.is_active !== false ? (
          <button
            type="button"
            className={styles.deactivateBtn}
            disabled={self || busy}
            onClick={() => handleDeactivateUser(u)}
          >
            {deactivatingId === u.user_id ? 'Deactivating…' : 'Deactivate'}
          </button>
        ) : (
          <button
            type="button"
            className={styles.reactivateBtn}
            disabled={self || busy}
            onClick={() => void handleReactivateUser(u)}
          >
            {activatingId === u.user_id ? 'Reactivating…' : 'Reactivate'}
          </button>
        )}
        <details className={styles.actionMenu}>
          <summary>More</summary>
          <button
            type="button"
            className={styles.deleteBtn}
            disabled={self || busy}
            onClick={() => handleDeleteUser(u)}
          >
            {deletingId === u.user_id ? 'Deleting…' : 'Delete permanently'}
          </button>
        </details>
        {self ? <span className={styles.selfNote}>You</span> : null}
      </div>
    );
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const tileColumns = useMemo(
    () => (selectedTile ? columnsForTile(selectedTile, tileRows) : []),
    [selectedTile, tileRows]
  );
  const tileHasUsers = useMemo(
    () => tileRows.some((row) => typeof row.user_id === 'string' && typeof row.email === 'string'),
    [tileRows]
  );
  const filteredTileRows = useMemo(() => {
    const query = tileSearch.trim().toLowerCase();
    return tileRows.filter((row) => {
      if (tileStatus === 'active' && row.is_active === false) return false;
      if (tileStatus === 'inactive' && row.is_active !== false) return false;
      if (!query) return true;
      return [row.email, row.full_name, row.user_id]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [tileRows, tileSearch, tileStatus]);

  if (allowed === null) {
    return (
      <div className={styles.page}>
        <p className={styles.hint}>Checking access…</p>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.page}>
      <Link to="/platform/users" className={styles.back}>
        ← All users
      </Link>
      <h1>User security audit</h1>
      <p className={styles.hint}>
        This page helps platform admins spot junk accounts and login attacks. You do not need to be
        technical — follow the <strong>What to do</strong> notes under each section.
      </p>

      <details className={styles.guideCard}>
        <summary className={styles.guideTitle}>How to use this page</summary>
        <ol className={styles.guideList}>
          <li>
            <strong>Unrecognized accounts</strong> (no event membership — may be a new sign-up, or
            leftover after an event was deleted) — choose <em>Recognize</em> if you know them, or
            select several → <em>Deactivate selected</em>. Use <em>Delete selected</em> only if you
            are sure they are junk.
          </li>
          <li>
            <strong>Accounts needing review</strong> — review the score and signals. Use{' '}
            <em>Recognize</em> / <em>Not suspicious</em> for known-safe accounts, or deactivate /
            delete the risky ones (bulk select works here too).
          </li>
          <li>
            <strong>Brute-force / failed logins</strong> — these are attack patterns, not people to
            delete. Turn on “Block password reset” for targeted admin emails under All users if your
            inbox is flooded.
          </li>
          <li>
            <strong>Reports &amp; blocks</strong> — clear test reports with <em>Clear</em> /{' '}
            <em>Clear all shown</em>. Unblock mistaken blocks with <em>Unblock</em>. For real issues,
            deactivate the reported person if needed.
          </li>
        </ol>
        <p className={styles.guideNote}>
          Tip: the platform already auto-deactivates some old orphan accounts daily. Bulk tools here
          are for faster manual cleanup.
        </p>
      </details>

      <nav className={styles.viewBar} aria-label="Account views">
        <strong>Account views</strong>
        <button
          type="button"
          className={styles.viewBtn}
          onClick={() => document.getElementById('needs-attention')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Needs attention
        </button>
        <button
          type="button"
          className={styles.viewBtn}
          onClick={() => void openTile('inactive_users', 'inactive')}
        >
          Deactivated {counts ? `(${counts.inactive_users})` : ''}
        </button>
        <button
          type="button"
          className={styles.viewBtn}
          onClick={() => void openTile('total_users', 'active')}
        >
          Active users
        </button>
        <Link to="/platform/users" className={styles.viewLink}>All users</Link>
      </nav>

      <p className={styles.hint}>
        <strong>Automated monitor</strong> means no person clicked anything — the platform detected a
        pattern. <strong>Target</strong> is who or what was affected. Alerts run every 5–10 minutes.
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
        </div>
      ) : null}

      {counts ? (
        <>
          <div className={styles.statsGrid}>
          {TILES.slice(0, 6).map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={styles.statCard}
              onClick={() => openTile(tile.key)}
              aria-label={`View ${tile.label}`}
            >
              <span className={styles.statValue}>{counts[tile.countKey] ?? 0}</span>
              <span className={styles.statLabel}>{tile.label}</span>
              <span className={styles.statHint}>Click for details</span>
            </button>
          ))}
          </div>
          <details className={styles.moreMetrics}>
            <summary>More security metrics</summary>
            <div className={styles.statsGrid}>
              {TILES.slice(6).map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  className={styles.statCard}
                  onClick={() => void openTile(tile.key)}
                  aria-label={`View ${tile.label}`}
                >
                  <span className={styles.statValue}>{counts[tile.countKey] ?? 0}</span>
                  <span className={styles.statLabel}>{tile.label}</span>
                  <span className={styles.statHint}>View details</span>
                </button>
              ))}
            </div>
          </details>
        </>
      ) : null}

      <section className={styles.section} id="needs-attention">
        <h2>Brute-force &amp; anomaly patterns (24h)</h2>
        <p className={styles.doThis}>
          <strong>What to do:</strong> Usually nothing to delete. If your own email appears under
          “Targeted emails,” open <Link to="/platform/users">All users</Link>, find that account, and
          turn on <em>Block self-serve password reset emails</em>. Rate limits already slow bots down.
        </p>
        <p className={styles.sectionHint}>
          Emails or IPs with repeated failed logins. Alerts fire at 5+ attempts in 15 minutes (same
          email or IP) or 3+ different emails from one IP.
        </p>
        {loading && !bruteForce ? (
          <p className={styles.hint}>Loading…</p>
        ) : (
          <div className={styles.anomalyGrid}>
            <div className={styles.anomalyCard}>
              <h3>Targeted emails</h3>
              {(bruteForce?.email_targets ?? []).length === 0 ? (
                <p className={styles.empty}>None detected.</p>
              ) : (
                <ul className={styles.anomalyList}>
                  {(bruteForce?.email_targets ?? []).slice(0, 8).map((row) => (
                    <li key={String(row.email)}>
                      <strong>{String(row.email)}</strong> — {String(row.attempt_count)} attempts
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={styles.anomalyCard}>
              <h3>Suspicious IPs</h3>
              {(bruteForce?.ip_targets ?? []).length === 0 ? (
                <p className={styles.empty}>None detected.</p>
              ) : (
                <ul className={styles.anomalyList}>
                  {(bruteForce?.ip_targets ?? []).slice(0, 8).map((row) => (
                    <li key={String(row.ip_address)}>
                      <strong>{String(row.ip_address)}</strong> — {String(row.attempt_count)} attempts
                      {row.distinct_emails ? `, ${String(row.distinct_emails)} emails` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={styles.anomalyCard}>
              <h3>Credential scanning</h3>
              {(bruteForce?.ip_scans ?? []).length === 0 ? (
                <p className={styles.empty}>None detected.</p>
              ) : (
                <ul className={styles.anomalyList}>
                  {(bruteForce?.ip_scans ?? []).slice(0, 8).map((row) => (
                    <li key={`scan-${String(row.ip_address)}`}>
                      <strong>{String(row.ip_address)}</strong> — {String(row.distinct_emails)} emails
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Accounts needing review</h2>
        <p className={styles.doThis}>
          <strong>What to do:</strong> If you know the account, choose <em>Recognize</em>. If you
          reviewed the warning and it is safe, choose <em>Not suspicious</em>. Deactivate only for
          likely spam or abuse.
        </p>
        <p className={styles.sectionHint}>
          Risk score from unrecognized status, reports, blocks, and failed logins (≥20 shown).
          Clearing a warning never deletes security history, and new activity can flag the account
          again.
        </p>
        {loading && suspicious.length === 0 ? (
          <p className={styles.hint}>Loading…</p>
        ) : suspicious.length === 0 ? (
          <p className={styles.empty}>No users above the risk threshold.</p>
        ) : (
          <>
            <div className={styles.bulkBar}>
              <label className={styles.bulkCheck}>
                <input
                  type="checkbox"
                  checked={
                    suspicious.length > 0 &&
                    suspicious.every((u) => selectedSuspiciousIds.has(u.user_id))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSuspiciousIds(new Set(suspicious.map((u) => u.user_id)));
                    } else {
                      setSelectedSuspiciousIds(new Set());
                    }
                  }}
                />
                Select all
              </label>
              <span className={styles.bulkMeta}>{selectedSuspiciousIds.size} selected</span>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={bulkBusy || selectedSuspiciousIds.size === 0}
                onClick={() =>
                  void runBulkAccountReview(
                    suspicious.filter((u) => selectedSuspiciousIds.has(u.user_id)),
                    'clear_risk'
                  )
                }
              >
                Not suspicious
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={
                  bulkBusy ||
                  !suspicious.some(
                    (u) =>
                      selectedSuspiciousIds.has(u.user_id) &&
                      u.signals?.includes('orphan_account')
                  )
                }
                onClick={() =>
                  void runBulkAccountReview(
                    suspicious.filter(
                      (u) =>
                        selectedSuspiciousIds.has(u.user_id) &&
                        u.signals?.includes('orphan_account')
                    ),
                    'recognize'
                  )
                }
              >
                Recognize selected
              </button>
              <button
                type="button"
                className={styles.deactivateBtn}
                disabled={bulkBusy || selectedSuspiciousIds.size === 0}
                onClick={() =>
                  void runBulkOnUsers(
                    suspicious.filter((u) => selectedSuspiciousIds.has(u.user_id)),
                    'deactivate'
                  )
                }
              >
                {bulkBusy ? 'Working…' : 'Deactivate selected'}
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                disabled={bulkBusy || selectedSuspiciousIds.size === 0}
                onClick={() =>
                  void runBulkOnUsers(
                    suspicious.filter((u) => selectedSuspiciousIds.has(u.user_id)),
                    'delete'
                  )
                }
              >
                Delete selected
              </button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkCol} />
                    <th>Score</th>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Signals</th>
                    <th>Reports</th>
                    <th>Blocks</th>
                    <th>Failed logins</th>
                    <th>Last login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suspicious.map((u) => (
                    <tr key={u.user_id}>
                      <td className={styles.checkCol}>
                        <input
                          type="checkbox"
                          checked={selectedSuspiciousIds.has(u.user_id)}
                          disabled={u.user_id === currentUserId}
                          onChange={() => toggleIdInSet(setSelectedSuspiciousIds, u.user_id)}
                          aria-label={`Select ${u.email}`}
                        />
                      </td>
                      <td>
                        <span
                          className={`${styles.scoreBadge} ${u.score >= 50 ? styles.scoreHigh : u.score >= 35 ? styles.scoreMed : ''}`}
                        >
                          {u.score}
                        </span>
                      </td>
                      <td>{u.email}</td>
                      <td>{u.full_name || '—'}</td>
                      <td className={styles.detailsCell}>{formatSignals(u.signals)}</td>
                      <td>{u.report_count}</td>
                      <td>{u.block_count}</td>
                      <td>{u.failed_logins_7d}</td>
                      <td>{formatWhen(u.last_login_at)}</td>
                      <td>
                        <div className={styles.actionCell}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            disabled={reviewBusyId === u.user_id}
                            onClick={() => void handleAccountReview(u, 'clear_risk')}
                          >
                            {reviewBusyId === u.user_id ? 'Saving…' : 'Not suspicious'}
                          </button>
                          {u.signals?.includes('orphan_account') ? (
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              disabled={reviewBusyId === u.user_id}
                              onClick={() => void handleAccountReview(u, 'recognize')}
                            >
                              Recognize
                            </button>
                          ) : null}
                          {renderUserActions(u)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>Reviewed and recognized accounts</h2>
        <p className={styles.sectionHint}>
          Current review decisions. Recognized accounts are removed from the unrecognized list;
          cleared accounts remain monitored for new reports, blocks, and failed logins.
        </p>
        {reviewedAccounts.length === 0 ? (
          <p className={styles.empty}>No account warnings have been cleared yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Review status</th>
                  <th>Note</th>
                  <th>Reviewed</th>
                  <th>Reviewed by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviewedAccounts.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.email}</td>
                    <td>{u.full_name || '—'}</td>
                    <td>{u.is_recognized ? 'Recognized' : 'Current warning cleared'}</td>
                    <td className={styles.detailsCell}>{u.note || '—'}</td>
                    <td>{formatWhen(u.reviewed_at)}</td>
                    <td>{u.reviewed_by_email || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        disabled={reviewBusyId === u.user_id}
                        onClick={() => void handleResetAccountReview(u)}
                      >
                        {reviewBusyId === u.user_id ? 'Resetting…' : 'Undo trusted status'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Cross-event safety</h2>
        <p className={styles.doThis}>
          <strong>What to do:</strong> Test reports → <em>Clear</em> (or <em>Clear all shown</em>).
          Mistaken blocks → <em>Unblock</em>. Real abuse → find the person in Accounts needing
          review / All users and deactivate.
        </p>
        <p className={styles.sectionHint}>
          All user reports and blocks across events. Per-event view remains under Event → Safety.
        </p>
        {safety?.counts ? (
          <p className={styles.meta}>
            {safety.counts.total_reports ?? 0} reports ({safety.counts.reports_7d ?? 0} in 7d) ·{' '}
            {safety.counts.total_blocks ?? 0} blocks ({safety.counts.blocks_7d ?? 0} in 7d) ·{' '}
            {safety.counts.repeat_offenders ?? 0} repeat offenders
          </p>
        ) : null}
        {loading && !safety ? (
          <p className={styles.hint}>Loading…</p>
        ) : (
          <>
            <div className={styles.bulkBar}>
              <h3 className={styles.subHeading} style={{ margin: 0, flex: 1 }}>
                Recent reports
              </h3>
              {(safety?.reports ?? []).length > 0 ? (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  disabled={bulkBusy || safetyBusyId !== null}
                  onClick={() => void handleClearAllShownReports()}
                >
                  {bulkBusy ? 'Clearing…' : 'Clear all shown'}
                </button>
              ) : null}
            </div>
            {(safety?.reports ?? []).length === 0 ? (
              <p className={styles.empty}>No reports yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Event</th>
                      <th>Reported</th>
                      <th>Reporter</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(safety?.reports ?? []).slice(0, 25).map((row, idx) => {
                      const reportId = String(row.report_id ?? '');
                      const reportedLabel = String(row.reported_email || row.reported_name || '');
                      return (
                        <tr key={reportId || idx}>
                          <td>{formatWhen(row.created_at as string)}</td>
                          <td>{String(row.event_name || '—')}</td>
                          <td>{reportedLabel || '—'}</td>
                          <td>{String(row.reporter_email || row.reporter_name || '—')}</td>
                          <td>{String(row.reason || '—')}</td>
                          <td className={styles.actionCell}>
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              disabled={!reportId || safetyBusyId === reportId || bulkBusy}
                              onClick={() => void handleClearReport(reportId, reportedLabel)}
                            >
                              {safetyBusyId === reportId ? '…' : 'Clear'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className={styles.subHeading}>Recent blocks</h3>
            {(safety?.blocks ?? []).length === 0 ? (
              <p className={styles.empty}>No blocks yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Blocker</th>
                      <th>Blocked</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(safety?.blocks ?? []).slice(0, 25).map((row, idx) => {
                      const blockId = String(row.block_id ?? '');
                      const blockedLabel = String(row.blocked_email || row.blocked_name || '');
                      return (
                        <tr key={blockId || idx}>
                          <td>{formatWhen(row.created_at as string)}</td>
                          <td>{String(row.blocker_email || row.blocker_name || '—')}</td>
                          <td>{blockedLabel || '—'}</td>
                          <td className={styles.actionCell}>
                            <button
                              type="button"
                              className={styles.deactivateBtn}
                              disabled={!blockId || safetyBusyId === blockId || bulkBusy}
                              onClick={() => void handleUnblock(blockId, blockedLabel)}
                            >
                              {safetyBusyId === blockId ? '…' : 'Unblock'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {selectedTile ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeTile}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tile-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHead}>
              <h2 id="tile-modal-title">{tileTitle || 'Details'}</h2>
              <button type="button" className={styles.modalClose} onClick={closeTile} aria-label="Close">
                ×
              </button>
            </div>
            {tileHasUsers && !tileLoading ? (
              <div className={styles.userFilters}>
                <input
                  className={styles.search}
                  value={tileSearch}
                  onChange={(e) => setTileSearch(e.target.value)}
                  placeholder="Search name or email"
                  aria-label="Search users"
                />
                <div className={styles.statusTabs} aria-label="Filter by account status">
                  {([
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['inactive', 'Deactivated'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`${styles.statusTab} ${tileStatus === value ? styles.statusTabActive : ''}`}
                      onClick={() => setTileStatus(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className={styles.filterCount}>{filteredTileRows.length} shown</span>
              </div>
            ) : null}
            {notice ? <p className={styles.modalNotice}>{notice}</p> : null}
            {tileLoading ? (
              <p className={styles.hint}>Loading…</p>
            ) : filteredTileRows.length === 0 ? (
              <p className={styles.empty}>No records for this category.</p>
            ) : (
              <div className={styles.modalTableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {tileColumns.map((col) => (
                        <th key={col}>{TILE_COLUMN_LABELS[col] ?? col.replace(/_/g, ' ')}</th>
                      ))}
                      {tileHasUsers ? <th>Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTileRows.map((row, idx) => {
                      const user =
                        typeof row.user_id === 'string' && typeof row.email === 'string'
                          ? {
                              user_id: row.user_id,
                              email: row.email,
                              full_name: typeof row.full_name === 'string' ? row.full_name : '',
                              is_active: row.is_active !== false,
                            }
                          : null;
                      return (
                      <tr key={String(row.id ?? row.user_id ?? row.report_id ?? idx)}>
                        {tileColumns.map((col) => (
                          <td key={col} className={col === 'details' ? styles.detailsCell : undefined}>
                            {formatCell(col, row[col])}
                          </td>
                        ))}
                        {tileHasUsers ? <td>{user ? renderUserActions(user) : '—'}</td> : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <section className={styles.section}>
        <h2>Unrecognized accounts</h2>
        <p className={styles.doThis}>
          <strong>What to do:</strong> These accounts have no event membership. Choose{' '}
          <em>Recognize</em> for someone you know. Deactivate likely spam, and delete only if you are
          certain it is junk.
        </p>
        <p className={styles.sectionHint}>
          Users with no event membership. You can also manage them in{' '}
          <Link to="/platform/users">All users</Link>.
        </p>
        {loading && orphans.length === 0 ? (
          <p className={styles.hint}>Loading…</p>
        ) : orphans.length === 0 ? (
          <p className={styles.empty}>No orphan accounts right now.</p>
        ) : (
          <>
            <div className={styles.bulkBar}>
              <label className={styles.bulkCheck}>
                <input
                  type="checkbox"
                  checked={orphans.length > 0 && orphans.every((o) => selectedOrphanIds.has(o.user_id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedOrphanIds(new Set(orphans.map((o) => o.user_id)));
                    } else {
                      setSelectedOrphanIds(new Set());
                    }
                  }}
                />
                Select all
              </label>
              <span className={styles.bulkMeta}>{selectedOrphanIds.size} selected</span>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={bulkBusy || selectedOrphanIds.size === 0}
                onClick={() =>
                  void runBulkAccountReview(
                    orphans.filter((o) => selectedOrphanIds.has(o.user_id)),
                    'recognize'
                  )
                }
              >
                Recognize selected
              </button>
              <button
                type="button"
                className={styles.deactivateBtn}
                disabled={bulkBusy || selectedOrphanIds.size === 0}
                onClick={() =>
                  void runBulkOnUsers(
                    orphans.filter((o) => selectedOrphanIds.has(o.user_id)),
                    'deactivate'
                  )
                }
              >
                {bulkBusy ? 'Working…' : 'Deactivate selected'}
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                disabled={bulkBusy || selectedOrphanIds.size === 0}
                onClick={() =>
                  void runBulkOnUsers(
                    orphans.filter((o) => selectedOrphanIds.has(o.user_id)),
                    'delete'
                  )
                }
              >
                Delete selected
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                disabled={bulkBusy}
                onClick={() => void handleDeactivateAllActiveOrphans()}
              >
                Deactivate all active
              </button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkCol} />
                    <th>Email</th>
                    <th>Name</th>
                    <th>Signed up</th>
                    <th>Last login</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orphans.map((o) => (
                    <tr key={o.user_id}>
                      <td className={styles.checkCol}>
                        <input
                          type="checkbox"
                          checked={selectedOrphanIds.has(o.user_id)}
                          disabled={o.user_id === currentUserId || o.is_platform_admin}
                          onChange={() => toggleIdInSet(setSelectedOrphanIds, o.user_id)}
                          aria-label={`Select ${o.email}`}
                        />
                      </td>
                      <td>{o.email}</td>
                      <td>{o.full_name || '—'}</td>
                      <td>{formatWhen(o.created_at)}</td>
                      <td>{formatWhen(o.last_login_at)}</td>
                      <td>{o.is_active ? 'Active' : 'Deactivated'}</td>
                      <td>
                        <div className={styles.actionCell}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            disabled={reviewBusyId === o.user_id}
                            onClick={() => void handleAccountReview(o, 'recognize')}
                          >
                            {reviewBusyId === o.user_id ? 'Saving…' : 'Recognize'}
                          </button>
                          {renderUserActions(o)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>Audit timeline</h2>
        <p className={styles.doThis}>
          <strong>What to do:</strong> Use this as a history log (who signed in, failed, got
          deactivated). You generally do not delete rows here — clean up the people in the sections
          above instead.
        </p>
        <div className={styles.filters}>
          <label className={styles.filterLabel}>
            Category
            <select
              className={styles.select}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel}>
            Search email or name
            <div className={styles.searchRow}>
              <input
                className={styles.search}
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="e.g. anesdaym13@gmail.com"
              />
              <button
                type="button"
                className={styles.searchBtn}
                onClick={() => {
                  setSearch(searchDraft);
                  setPage(1);
                }}
              >
                Search
              </button>
            </div>
          </label>
        </div>

        {loading && rows.length === 0 ? (
          <p className={styles.hint}>Loading audit log…</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty}>No audit events match your filters.</p>
        ) : (
          <>
            <p className={styles.meta}>
              Showing {rows.length} of {total} events
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Category</th>
                    <th>Action</th>
                    <th>What happened</th>
                    <th>Target</th>
                    <th>By</th>
                    <th>Technical</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const actor = auditActorLabel(row);
                    const plain = auditPlainSummary(row);
                    const technical = detailSummary(row.details);
                    return (
                    <tr key={row.id}>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[`badge_${row.category}`] ?? ''}`}>
                          {row.category}
                        </span>
                      </td>
                      <td>{actionLabel(row.action)}</td>
                      <td className={styles.summaryCell}>{plain}</td>
                      <td>{auditTargetLabel(row)}</td>
                      <td>
                        <div>{actor.primary}</div>
                        {actor.hint ? <div className={styles.subtle}>{actor.hint}</div> : null}
                      </td>
                      <td className={styles.detailsCell}>{technical || '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                <span className={styles.pageMeta}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>What this page tracks</h2>
        <ul className={styles.featureList}>
          <li>
            <strong>Auth</strong> — sign-ups and logins (including failed attempts)
          </li>
          <li>
            <strong>Brute-force</strong> — automated guessing / reset spam patterns (not accounts to
            delete)
          </li>
          <li>
            <strong>Unrecognized accounts</strong> — people with no event; recognize known accounts
            or bulk deactivate junk
          </li>
          <li>
            <strong>Accounts needing review</strong> — higher risk scores; clear false positives or
            deactivate/delete real risk
          </li>
          <li>
            <strong>Safety</strong> — attendee reports and blocks across events
          </li>
          <li>
            <strong>Admin actions</strong> — when a platform admin deactivated or deleted someone
          </li>
        </ul>
      </section>
    </div>
  );
}
