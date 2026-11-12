import { useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import { logAuthAttempt } from '../lib/logAuthAttempt';
import { getLoginRateLimitError, recordLoginRateLimitAttempt } from '../lib/loginRateLimit';
import { ACCOUNT_DEACTIVATED_MESSAGE, isAccountActive } from '../lib/accountActive';
import { userNeedsCadminEmailOtp } from '../lib/cadminAdminAccess';
import { clearPlatformAdminEmailOtp } from '../lib/platformAdminEmailOtp';
import { markAwaitingPlatformAdminEmailOtp } from './LoginEmailCode';
import styles from './Login.module.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() ?? '';
    try {
      const rateLimitError = await getLoginRateLimitError(trimmedEmail);
      if (rateLimitError) {
        setError(rateLimitError);
        setLoading(false);
        return;
      }
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (err) {
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
          errorMessage: err.message,
          anonKey,
        });
        throw err;
      }
      const user = data?.user;
      if (!user?.id) {
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
          errorMessage: 'Login failed',
          anonKey,
        });
        setError('Login failed.');
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('is_platform_admin, is_active')
        .eq('id', user.id)
        .single();
      if (!isAccountActive((profile as { is_active?: boolean | null } | null)?.is_active)) {
        await supabase.auth.signOut();
        recordLoginRateLimitAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
        });
        logAuthAttempt({
          email: trimmedEmail,
          success: false,
          source: 'cadmin',
          errorMessage: 'account_deactivated',
          userId: user.id,
          anonKey,
        });
        setError(ACCOUNT_DEACTIVATED_MESSAGE);
        setLoading(false);
        return;
      }
      recordLoginRateLimitAttempt({
        email: trimmedEmail,
        success: true,
        source: 'cadmin',
        accessToken: data.session?.access_token,
      });
      logAuthAttempt({
        email: trimmedEmail,
        success: true,
        source: 'cadmin',
        userId: user.id,
        anonKey,
        accessToken: data.session?.access_token,
      });
      const access = await userNeedsCadminEmailOtp(user.id);
      if (access.needsOtp) {
        clearPlatformAdminEmailOtp();
        markAwaitingPlatformAdminEmailOtp();
        // Keep the button in "Signing in…" until App swaps to the email-code gate.
        // Do not setLoading(false) — that briefly re-showed the password form.
        return;
      }
      await supabase.auth.signOut();
      setError('Access restricted. Only event admins and platform admins can sign in. If you need access, ask your event organizer.');
      setLoading(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      setLoading(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.logoWrap}>
            <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
          </div>
          <h1 className={styles.title}>Admin</h1>
          <p className={styles.errorRestricted}>
            Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
        </div>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.subtitle}>Event setup — sign in with your admin account</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={error.includes('Access restricted') ? styles.errorRestricted : styles.error}>
              {error}
            </div>
          )}
          <label className={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={styles.input}
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={styles.input}
            />
          </label>
          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className={styles.footer}>
          <a href="https://kbmcollective.org" target="_blank" rel="noopener noreferrer">KBM Collective</a>
        </p>
      </div>
    </div>
  );
}
