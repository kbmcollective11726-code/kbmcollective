import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { linkAndLoadVendorSubmission, loadVendorPortalEvent } from '../lib/vendorPortal';
import styles from './delegate-portal/DelegatePortal.module.css';

export default function VendorLogin() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const stateError = (location.state as { error?: string; message?: string } | null)?.error ?? '';
  const stateMessage = (location.state as { error?: string; message?: string } | null)?.message ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(stateError);
  const [loading, setLoading] = useState(false);
  const [eventName, setEventName] = useState('');

  useEffect(() => {
    if (!eventId) return;
    void loadVendorPortalEvent(eventId).then((e) => setEventName(e?.name ?? ''));
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setError('');
    setLoading(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) throw signInErr;

      const sub = await linkAndLoadVendorSubmission(eventId);
      if (!sub) {
        await supabase.auth.signOut();
        throw new Error('No submitted vendor registration found for this email. Complete registration first.');
      }
      if (sub.registration_status === 'rejected') {
        await supabase.auth.signOut();
        throw new Error('Your registration was not approved. Contact the event organizer.');
      }

      navigate(`/portal/${eventId}/vendor/welcome`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <h1>Vendor sign in</h1>
        {eventName ? <p className={styles.hint}>{eventName}</p> : null}
        <p className={styles.hint}>Sign in to view your vendor profile and meeting preferences.</p>
        {stateMessage ? <p className={styles.success}>{stateMessage}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        <form onSubmit={(e) => void handleSubmit(e)} className={styles.grid2}>
          <label style={{ gridColumn: '1 / -1' }}>
            Email
            <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} required autoComplete="email" />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            Password
            <input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)} required autoComplete="current-password" />
          </label>
          <button type="submit" className={styles.primaryBtn} style={{ gridColumn: '1 / -1' }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {eventId ? (
          <p className={styles.hint} style={{ marginTop: 16 }}>
            Need to register? <Link to={`/register/${eventId}/vendor`}>Complete vendor registration</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
