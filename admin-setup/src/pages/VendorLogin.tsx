import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { logAuthAttempt } from '../lib/logAuthAttempt';
import { getLoginRateLimitError, recordLoginRateLimitAttempt } from '../lib/loginRateLimit';
import { ACCOUNT_DEACTIVATED_MESSAGE, rejectIfAccountDeactivated } from '../lib/accountActive';
import { linkAndLoadVendorSubmission, loadVendorPortalEvent } from '../lib/vendorPortal';
import PortalGuestNav from '../components/PortalGuestNav';
import PortalPublicShell from '../components/PortalPublicShell';
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
  const [event, setEvent] = useState<Awaited<ReturnType<typeof loadVendorPortalEvent>>>(null);

  useEffect(() => {
    if (!eventId) return;
    void loadVendorPortalEvent(eventId).then(setEvent);
  }, [eventId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setError('');
    setLoading(true);
    const trimmedEmail = email.trim().toLowerCase();
    try {
      const rateLimitError = await getLoginRateLimitError(trimmedEmail);
      if (rateLimitError) {
        setError(rateLimitError);
        setLoading(false);
        return;
      }
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (signInErr) {
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
          errorMessage: signInErr.message,
        });
        throw signInErr;
      }

      const userId = data.user?.id;
      if (userId) {
        const deactivated = await rejectIfAccountDeactivated(userId);
        if (deactivated) {
          recordLoginRateLimitAttempt({
            email: trimmedEmail,
            success: false,
            source: 'portal',
          });
          logAuthAttempt({
            email: trimmedEmail,
            success: false,
            source: 'portal',
            errorMessage: 'account_deactivated',
            userId,
          });
          throw new Error(ACCOUNT_DEACTIVATED_MESSAGE);
        }
      }
      const sub = await linkAndLoadVendorSubmission(eventId);
      if (!sub) {
        await supabase.auth.signOut();
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
          errorMessage: 'No submitted vendor registration',
          userId,
        });
        throw new Error('No submitted vendor registration found for this email. Complete registration first.');
      }
      if (sub.registration_status === 'rejected') {
        await supabase.auth.signOut();
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'portal',
          errorMessage: 'Registration rejected',
          userId,
        });
        throw new Error('Your registration was not approved. Contact the event organizer.');
      }

      recordLoginRateLimitAttempt({
        email: trimmedEmail,
        success: true,
        source: 'portal',
        accessToken: data.session?.access_token,
      });
      logAuthAttempt({
        email: trimmedEmail,
        success: true,
        source: 'portal',
        userId,
        accessToken: data.session?.access_token,
      });
      navigate(`/portal/${eventId}/vendor/welcome`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  if (!eventId) {
    return <div className={styles.page}>Missing event.</div>;
  }

  return (
    <PortalPublicShell
      event={event}
      nav={<PortalGuestNav eventId={eventId} role="vendor" activeTab="login" />}
    >
      <div className={styles.authCard}>
        <h1>Vendor sign in</h1>
        {event?.name ? <p className={styles.hint} style={{ textAlign: 'center' }}>{event.name}</p> : null}
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
        <p className={styles.hint} style={{ marginTop: 16, textAlign: 'center' }}>
          Need to register? <Link to={`/register/${eventId}/vendor`}>Complete vendor registration</Link>
        </p>
      </div>
    </PortalPublicShell>
  );
}
