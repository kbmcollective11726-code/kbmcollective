import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  clearPlatformAdminEmailOtp,
  sendPlatformAdminEmailOtp,
  verifyPlatformAdminEmailOtp,
} from '../lib/platformAdminEmailOtp';
import styles from './Login.module.css';

/** Set after a successful password login so expired step-up does not open this screen. */
export const CADMIN_AWAITING_EMAIL_OTP_KEY = 'cadmin_awaiting_email_otp';

const SENT_KEY = 'cadmin_platform_otp_sent_at';
/** Keep code-entry UI for a bit longer than the 10-minute OTP so remounts don't reset it. */
const SENT_UI_TTL_MS = 15 * 60 * 1000;

export function markAwaitingPlatformAdminEmailOtp(): void {
  try {
    sessionStorage.setItem(CADMIN_AWAITING_EMAIL_OTP_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearAwaitingPlatformAdminEmailOtp(): void {
  try {
    sessionStorage.removeItem(CADMIN_AWAITING_EMAIL_OTP_KEY);
  } catch {
    /* ignore */
  }
}

export function isAwaitingPlatformAdminEmailOtp(): boolean {
  try {
    return sessionStorage.getItem(CADMIN_AWAITING_EMAIL_OTP_KEY) === '1';
  } catch {
    return false;
  }
}

type SentRecord = { userId: string; at: number; hint?: string };

function readSent(): SentRecord | null {
  try {
    const raw = sessionStorage.getItem(SENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SentRecord;
    if (!parsed?.userId || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > SENT_UI_TTL_MS) {
      sessionStorage.removeItem(SENT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function markSent(userId: string, hint?: string): void {
  try {
    const prev = readSent();
    sessionStorage.setItem(
      SENT_KEY,
      JSON.stringify({
        userId,
        at: Date.now(),
        hint: hint || prev?.hint || '',
      } satisfies SentRecord)
    );
  } catch {
    /* ignore */
  }
}

function clearSent(): void {
  try {
    sessionStorage.removeItem(SENT_KEY);
  } catch {
    /* ignore */
  }
}

export default function LoginEmailCode() {
  const navigate = useNavigate();
  const initialSent = readSent();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState(initialSent?.hint ?? '');
  const [sent, setSent] = useState(!!initialSent);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Tab return / parent remount can remount this screen — restore "code sent" UI from sessionStorage.
  useEffect(() => {
    const restore = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const record = readSent();
      if (record && record.userId === uid) {
        setSent(true);
        if (record.hint) setHint(record.hint);
      }
    };
    void restore();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void restore();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const sendCode = useCallback(async () => {
    setError('');
    setSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        clearAwaitingPlatformAdminEmailOtp();
        navigate('/login', { replace: true });
        return;
      }
      const result = await sendPlatformAdminEmailOtp();
      const emailHint = typeof result.email_hint === 'string' ? result.email_hint : '';
      markSent(session.user.id, emailHint);
      setSent(true);
      if (emailHint) setHint(emailHint);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send code.');
    } finally {
      setSending(false);
    }
  }, [navigate]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    try {
      await verifyPlatformAdminEmailOtp(trimmed);
      clearSent();
      clearAwaitingPlatformAdminEmailOtp();
      // Full navigation so App re-reads the OTP gate.
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    clearSent();
    clearAwaitingPlatformAdminEmailOtp();
    clearPlatformAdminEmailOtp();
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
        </div>
        <h1 className={styles.title}>Email verification</h1>
        <p className={styles.subtitle}>
          Admins need a one-time code to finish signing in to cadmin.
          {sent ? (
            hint ? (
              <>
                {' '}
                We sent a code to <strong>{hint}</strong>. Enter it below — this screen will stay here while you copy it from email.
              </>
            ) : (
              ' We sent a 6-digit code to your account email. Enter it below — this screen will stay here while you copy it from email.'
            )
          ) : (
            ' Click Send code, then enter the 6-digit code from your email.'
          )}
        </p>

        {sending ? <p className={styles.subtitle}>Sending code…</p> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {!sent ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => void sendCode()}
            disabled={sending || loading}
          >
            {sending ? 'Sending…' : 'Send code'}
          </button>
        ) : (
          <form onSubmit={handleVerify} className={styles.form}>
            <label className={styles.label}>
              Email code
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
                disabled={sending || loading}
                autoFocus
              />
            </label>
            <button type="submit" disabled={loading || sending} className={styles.button}>
              {loading ? 'Verifying…' : 'Verify & continue'}
            </button>
          </form>
        )}

        {sent ? (
          <p className={styles.footer}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => void sendCode()}
              disabled={sending || loading}
            >
              {sending ? 'Sending…' : 'Resend code'}
            </button>
          </p>
        ) : null}
        <p className={styles.footer}>
          <button type="button" className={styles.linkBtn} onClick={() => void handleSignOut()}>
            Back to login
          </button>
        </p>
      </div>
    </div>
  );
}
