import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
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

type TileConfig = {
  key: TileKey;
  label: string;
  countKey: keyof OverviewCounts;
};

const TILES: TileConfig[] = [
  { key: 'total_users', label: 'Total accounts', countKey: 'total_users' },
  { key: 'orphan_accounts', label: 'No event membership', countKey: 'orphan_accounts' },
  { key: 'suspicious_users', label: 'Suspicious users', countKey: 'suspicious_users' },
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
  user_report: 'User reported',
  orphan_signup_alert: 'Orphan sign-up alert sent',
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
      return 'Email alert sent: new sign-up with no event membership.';
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
    return value.length ? value.join(', ') : '—';
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
    inactive_users: ['email', 'full_name', 'created_at', 'last_login_at'],
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  const [bruteForce, setBruteForce] = useState<BruteForcePack | null>(null);
  const [safety, setSafety] = useState<SafetyOverview | null>(null);
  const [suspicious, setSuspicious] = useState<SuspiciousUser[]>([]);
  const pageSize = 50;

  useEffect(() => {
    isCurrentUserPlatformAdmin().then(setAllowed);
  }, []);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [overviewRes, auditRes, bruteRes, safetyRes, suspiciousRes] = await Promise.all([
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
        supabase.rpc('list_suspicious_users', { p_limit: 50, p_min_score: 20 }),
      ]);

      if (overviewRes.error) throw overviewRes.error;
      const overview = overviewRes.data as {
        error?: string;
        counts?: OverviewCounts;
        orphan_accounts?: OrphanAccount[];
      } | null;
      if (overview?.error) throw new Error(overview.error);
      setCounts(overview?.counts ?? null);
      setOrphans(Array.isArray(overview?.orphan_accounts) ? overview!.orphan_accounts! : []);

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

      if (suspiciousRes.error) throw suspiciousRes.error;
      const susPack = suspiciousRes.data as { error?: string; rows?: SuspiciousUser[] } | null;
      if (susPack?.error) throw new Error(susPack.error);
      setSuspicious(Array.isArray(susPack?.rows) ? susPack!.rows! : []);
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setRows([]);
      setOrphans([]);
      setBruteForce(null);
      setSafety(null);
      setSuspicious([]);
    } finally {
      setLoading(false);
    }
  }, [category, page, search]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const openTile = useCallback(async (tile: TileKey) => {
    setSelectedTile(tile);
    setTileLoading(true);
    setTileRows([]);
    setTileTitle('');
    try {
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
  }, []);

  const closeTile = () => {
    setSelectedTile(null);
    setTileRows([]);
    setTileTitle('');
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const tileColumns = useMemo(
    () => (selectedTile ? columnsForTile(selectedTile, tileRows) : []),
    [selectedTile, tileRows]
  );

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
        Platform-wide account activity, failed logins, brute-force patterns, cross-event safety,
        suspicious user scoring, and admin actions. Click any summary tile for details.{' '}
        <strong>Automated monitor</strong> means no person clicked anything — the platform detected
        a pattern (e.g. many failed logins). <strong>Target</strong> is who or what was affected;
        IP-based alerts show the internet address. Alerts run every 5–10 minutes (in-app always;
        email when Resend is configured).
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      {counts ? (
        <div className={styles.statsGrid}>
          {TILES.map((tile) => (
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
      ) : null}

      <section className={styles.section}>
        <h2>Brute-force &amp; anomaly patterns (24h)</h2>
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
        <h2>Suspicious users</h2>
        <p className={styles.sectionHint}>
          Risk score from orphan status, reports, blocks, and failed logins (≥20 shown). Review in{' '}
          <Link to="/platform/users">All users</Link> to deactivate or delete.
        </p>
        {loading && suspicious.length === 0 ? (
          <p className={styles.hint}>Loading…</p>
        ) : suspicious.length === 0 ? (
          <p className={styles.empty}>No users above the risk threshold.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Signals</th>
                  <th>Reports</th>
                  <th>Blocks</th>
                  <th>Failed logins</th>
                  <th>Last login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suspicious.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      <span className={`${styles.scoreBadge} ${u.score >= 50 ? styles.scoreHigh : u.score >= 35 ? styles.scoreMed : ''}`}>
                        {u.score}
                      </span>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.full_name || '—'}</td>
                    <td className={styles.detailsCell}>{u.signals?.join(', ') || '—'}</td>
                    <td>{u.report_count}</td>
                    <td>{u.block_count}</td>
                    <td>{u.failed_logins_7d}</td>
                    <td>{formatWhen(u.last_login_at)}</td>
                    <td>
                      <Link
                        to={`/platform/users?search=${encodeURIComponent(u.email)}`}
                        className={styles.manageLink}
                      >
                        Deactivate
                      </Link>
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
            <h3 className={styles.subHeading}>Recent reports</h3>
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
                    </tr>
                  </thead>
                  <tbody>
                    {(safety?.reports ?? []).slice(0, 25).map((row, idx) => (
                      <tr key={String(row.report_id ?? idx)}>
                        <td>{formatWhen(row.created_at as string)}</td>
                        <td>{String(row.event_name || '—')}</td>
                        <td>{String(row.reported_email || row.reported_name || '—')}</td>
                        <td>{String(row.reporter_email || row.reporter_name || '—')}</td>
                        <td>{String(row.reason || '—')}</td>
                      </tr>
                    ))}
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
                    </tr>
                  </thead>
                  <tbody>
                    {(safety?.blocks ?? []).slice(0, 25).map((row, idx) => (
                      <tr key={String(row.block_id ?? idx)}>
                        <td>{formatWhen(row.created_at as string)}</td>
                        <td>{String(row.blocker_email || row.blocker_name || '—')}</td>
                        <td>{String(row.blocked_email || row.blocked_name || '—')}</td>
                      </tr>
                    ))}
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
            {tileLoading ? (
              <p className={styles.hint}>Loading…</p>
            ) : tileRows.length === 0 ? (
              <p className={styles.empty}>No records for this category.</p>
            ) : (
              <div className={styles.modalTableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {tileColumns.map((col) => (
                        <th key={col}>{TILE_COLUMN_LABELS[col] ?? col.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tileRows.map((row, idx) => (
                      <tr key={String(row.id ?? row.user_id ?? row.report_id ?? idx)}>
                        {tileColumns.map((col) => (
                          <td key={col} className={col === 'details' ? styles.detailsCell : undefined}>
                            {formatCell(col, row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <section className={styles.section}>
        <h2>Unrecognized accounts</h2>
        <p className={styles.sectionHint}>
          Users with no event membership — often random app sign-ups. Review and delete from{' '}
          <Link to="/platform/users">All users</Link> if they should not have access.
        </p>
        {loading && orphans.length === 0 ? (
          <p className={styles.hint}>Loading…</p>
        ) : orphans.length === 0 ? (
          <p className={styles.empty}>No orphan accounts right now.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Signed up</th>
                  <th>Last login</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map((o) => (
                  <tr key={o.user_id}>
                    <td>{o.email}</td>
                    <td>{o.full_name || '—'}</td>
                    <td>{formatWhen(o.created_at)}</td>
                    <td>{formatWhen(o.last_login_at)}</td>
                    <td>{o.is_active ? 'Active' : 'Deactivated'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2>Audit timeline</h2>
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
            <strong>Auth</strong> — sign-ups, successful logins, failed logins (mobile app + cadmin)
          </li>
          <li>
            <strong>Brute-force</strong> — pattern detection with in-app + email alerts every 5 minutes
          </li>
          <li>
            <strong>Safety</strong> — cross-event reports, blocks, repeat offenders, suspicious user scores
          </li>
          <li>
            <strong>Admin</strong> — deletes, password resets, platform admin changes, deactivations
          </li>
          <li>
            <strong>Email alerts</strong> — platform admins emailed for orphan sign-ups and brute-force
            patterns (requires <code>RESEND_API_KEY</code> on edge functions)
          </li>
        </ul>
      </section>
    </div>
  );
}
