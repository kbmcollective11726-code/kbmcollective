import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { loadVendorPortalEvent } from '../../lib/vendorPortal';
import {
  establishPortalAuthSession,
  parseAuthParamsFromUrl,
  portalSetPasswordExpiredMessage,
} from '../../lib/portalAuthSession';
import styles from '../delegate-portal/DelegatePortal.module.css';

export default function VendorSetPassword() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [eventName, setEventName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    void loadVendorPortalEvent(eventId).then((e) => setEventName(e?.name ?? ''));

    const params = parseAuthParamsFromUrl();

    void establishPortalAuthSession(params)
      .then((result) => {
        if (!result.ok) {
          setError(
            result.error === 'missing_tokens'
              ? portalSetPasswordExpiredMessage('vendor')
              : result.error,
          );
          return;
        }
        setReady(true);
        window.history.replaceState({}, '', window.location.pathname);
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      navigate(`/portal/${eventId}/vendor/login`, {
        replace: true,
        state: { message: 'Password saved. Sign in with your email and new password.' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save password');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading password setup…</div>;
  }

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <h1>Set your password</h1>
        {eventName ? <p className={styles.hint}>{eventName}</p> : null}
        {!ready ? (
          <>
            {error ? <p className={styles.error}>{error}</p> : null}
            {eventId ? (
              <p className={styles.hint}>
                <Link to={`/register/${eventId}/vendor`}>Return to registration</Link>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.hint}>Choose a password for your vendor portal sign-in.</p>
            {error ? <p className={styles.error}>{error}</p> : null}
            <form onSubmit={(e) => void submit(e)} className={styles.grid2}>
              <label style={{ gridColumn: '1 / -1' }}>
                New password
                <input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Confirm password
                <input type="password" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} required minLength={8} autoComplete="new-password" />
              </label>
              <button type="submit" className={styles.primaryBtn} style={{ gridColumn: '1 / -1' }} disabled={saving}>
                {saving ? 'Saving…' : 'Save password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
