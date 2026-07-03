import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { loadDelegatePortalEvent } from '../../lib/delegatePortal';
import styles from './DelegatePortal.module.css';

function parseAuthParamsFromUrl(): Record<string, string> {
  const out: Record<string, string> = {};
  const hash = window.location.hash.replace(/^#/, '');
  const search = window.location.search.replace(/^\?/, '');
  for (const part of [hash, search]) {
    if (!part) continue;
    new URLSearchParams(part).forEach((v, k) => {
      if (!(k in out)) out[k] = v;
    });
  }
  return out;
}

export default function DelegateSetPassword() {
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
    void loadDelegatePortalEvent(eventId).then((e) => setEventName(e?.name ?? ''));

    const params = parseAuthParamsFromUrl();
    const errDesc = params.error_description || params.error;
    if (errDesc) {
      setError(decodeURIComponent(errDesc.replace(/\+/g, ' ')));
      setLoading(false);
      return;
    }

    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    if (!accessToken || !refreshToken) {
      setError(
        'This link is missing or has expired. Go back to the registration page and tap Register delegate again for a new link.'
      );
      setLoading(false);
      return;
    }

    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionErr }) => {
        if (sessionErr) {
          setError(sessionErr.message);
        } else {
          setReady(true);
          window.history.replaceState({}, '', window.location.pathname);
        }
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
      navigate(`/portal/${eventId}/delegate/login`, {
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
                <Link to={`/register/${eventId}/delegate`}>Return to registration</Link>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.hint}>Choose a password for your delegate portal sign-in.</p>
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
