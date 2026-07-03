import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  clearUnverifiedTotpFactors,
  enrollCadminMfa,
  getCadminMfaState,
  getTotpFactorIdForChallenge,
  verifyCadminMfaEnrollment,
  verifyCadminMfaLogin,
} from '../lib/cadminMfa';
import styles from './Login.module.css';

type EnrollData = {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string | null;
};

export default function LoginMfa() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'loading' | 'enroll' | 'verify'>('loading');
  const [enroll, setEnroll] = useState<EnrollData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [completingEnrollment, setCompletingEnrollment] = useState(false);
  const [resetting, setResetting] = useState(false);

  const bootstrap = useCallback(async () => {
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate('/login', { replace: true });
        return;
      }

      const state = await getCadminMfaState();
      if (state === 'ready') {
        navigate('/', { replace: true });
        return;
      }

      if (state === 'verify') {
        const { factorId: id, completingEnrollment: finishing } = await getTotpFactorIdForChallenge();
        setFactorId(id);
        setCompletingEnrollment(finishing);
        setMode('verify');
        return;
      }

      const { data: enrollData, error: enrollErr } = await enrollCadminMfa();
      if (enrollErr) {
        if (enrollErr.message.toLowerCase().includes('mfa')) {
          setError(
            'Multi-factor authentication must be enabled in your Supabase project (Authentication → MFA). Contact your platform admin.'
          );
        } else {
          setError(enrollErr.message);
        }
        setMode('enroll');
        return;
      }

      if (!enrollData) {
        setError('Could not start MFA enrollment.');
        setMode('enroll');
        return;
      }

      setEnroll(enrollData);
      setMode('enroll');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load MFA setup.');
      setMode('enroll');
    }
  }, [navigate]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'enroll' && enroll) {
        await verifyCadminMfaEnrollment(enroll.factorId, trimmed);
      } else if (mode === 'verify' && factorId) {
        if (completingEnrollment) {
          await verifyCadminMfaEnrollment(factorId, trimmed);
        } else {
          await verifyCadminMfaLogin(factorId, trimmed);
        }
      } else {
        throw new Error('MFA is not ready. Refresh and try again.');
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = async () => {
    setError('');
    setResetting(true);
    try {
      await clearUnverifiedTotpFactors();
      setEnroll(null);
      setFactorId(null);
      setCompletingEnrollment(false);
      setCode('');
      const { data: enrollData, error: enrollErr } = await enrollCadminMfa();
      if (enrollErr) throw enrollErr;
      if (!enrollData) throw new Error('Could not start MFA enrollment.');
      setEnroll(enrollData);
      setMode('enroll');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset MFA setup.');
    } finally {
      setResetting(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  if (mode === 'loading') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <p className={styles.subtitle}>Loading security check…</p>
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
        <h1 className={styles.title}>
          {mode === 'enroll' ? 'Set up MFA' : completingEnrollment ? 'Complete MFA setup' : 'Verify MFA'}
        </h1>
        <p className={styles.subtitle}>
          {mode === 'enroll'
            ? 'Scan the QR code with Google Authenticator, 1Password, or Authy. If scanning fails, use “Enter a setup key” and paste the manual key below.'
            : completingEnrollment
              ? 'Open your authenticator app (you may have added KBM cadmin already). Enter the current 6-digit code — nothing is sent by text or email.'
              : 'Enter the 6-digit code from your authenticator app to continue.'}
        </p>

        {error ? <div className={styles.error}>{error}</div> : null}

        {mode === 'enroll' && enroll ? (
          <div className={styles.mfaQrWrap}>
            <img src={enroll.qrCode} alt="MFA QR code" className={styles.mfaQr} />
            <p className={styles.mfaSecret}>
              Manual key (Time-based): <code>{enroll.secret}</code>
            </p>
            <p className={styles.mfaHint}>
              Google Authenticator: + → Enter a setup key → Account name “KBM cadmin” → paste key above.
            </p>
          </div>
        ) : null}

        <form onSubmit={handleVerify} className={styles.form}>
          <label className={styles.label}>
            Authenticator code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              className={styles.input}
              placeholder="000000"
            />
          </label>
          <button type="submit" disabled={loading} className={styles.button}>
            {loading
              ? 'Verifying…'
              : mode === 'enroll' || completingEnrollment
                ? 'Enable MFA & continue'
                : 'Verify & continue'}
          </button>
        </form>

        {mode === 'verify' && completingEnrollment ? (
          <p className={styles.footer}>
            <button type="button" className={styles.linkBtn} onClick={handleStartOver} disabled={resetting}>
              {resetting ? 'Resetting…' : 'Need a new QR code? Set up again'}
            </button>
          </p>
        ) : null}

        <p className={styles.footer}>
          <button type="button" className={styles.linkBtn} onClick={handleSignOut}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
