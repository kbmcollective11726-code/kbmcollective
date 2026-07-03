import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { badgeAppDeepLink } from '../lib/badgeQrUrl';

const ANDROID_PACKAGE = 'com.kbmcollective.collectivelive';
const BADGE_LANDING = 'https://cadmin.kbmcollective.org/badge';

function normalizeToken(raw: string): string {
  const t = raw.trim();
  if (/^[a-f0-9]{48}$/i.test(t)) return t.toLowerCase();
  if (t.length >= 16 && /^[a-f0-9]+$/i.test(t)) return t.toLowerCase();
  return '';
}

function androidIntentHref(token: string): string {
  const fallback = encodeURIComponent(`${BADGE_LANDING}?t=${encodeURIComponent(token)}`);
  return `intent://badge?t=${encodeURIComponent(token)}#Intent;scheme=collectivelive;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

function isAndroidUa(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * Public landing page for badge QR codes (HTTPS so phone cameras recognize the link).
 * iOS/Android block automatic custom-scheme redirects — user must tap the button (one tap).
 */
export default function BadgeOpen() {
  const [params] = useSearchParams();
  const token = useMemo(() => normalizeToken(params.get('t') || params.get('token') || ''), [params]);

  if (!token) {
    return (
      <main style={shell}>
        <h1 style={title}>Invalid badge link</h1>
        <p style={body}>
          This QR code is missing a valid badge token. Ask the event team to regenerate badge tokens in cadmin and
          reprint.
        </p>
      </main>
    );
  }

  const deepLink = badgeAppDeepLink(token);
  const openHref = isAndroidUa() ? androidIntentHref(token) : deepLink;

  return (
    <main style={shell}>
      <p style={kicker}>KBM Connect</p>
      <h1 style={title}>Badge scanned</h1>
      <p style={body}>
        <strong>Tap the button below</strong> to open the KBM Connect app and view this person&apos;s badge.
        (Your phone cannot open the app automatically from the camera — one tap is required.)
      </p>
      <a href={openHref} style={btn}>
        Open in KBM Connect
      </a>
      <p style={finePrint}>
        Already in the app? Go to <strong>Profile → Scan badge</strong> and point at the QR again.
      </p>
    </main>
  );
}

const shell: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 24px',
  fontFamily: 'system-ui, sans-serif',
  textAlign: 'center',
  background: '#0f172a',
  color: '#f8fafc',
};

const kicker: CSSProperties = {
  margin: '0 0 8px',
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#d4af37',
};

const title: CSSProperties = { margin: '0 0 12px', fontSize: '1.5rem' };
const body: CSSProperties = { margin: '0 0 24px', maxWidth: 420, lineHeight: 1.55, color: '#cbd5e1', fontSize: '16px' };
const btn: CSSProperties = {
  display: 'inline-block',
  padding: '16px 28px',
  background: '#d4af37',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: '17px',
  textDecoration: 'none',
  borderRadius: 10,
  boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
};
const finePrint: CSSProperties = { margin: '20px 0 0', maxWidth: 400, fontSize: '13px', lineHeight: 1.45, color: '#94a3b8' };
