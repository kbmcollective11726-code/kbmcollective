import styles from './Layout.module.css';

type IconName = 'events' | 'users' | 'audit' | 'guide' | 'owasp' | 'compute' | 'help';

const paths: Record<IconName, JSX.Element> = {
  events: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 2v4M8 2v4M3 10h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M2 20c0-3.3 3.1-5 7-5s7 1.7 7 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="17" cy="9" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M14 20c.3-2 2.2-3.5 5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <path
        d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  owasp: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <path
        d="M4 19V5h4.2c2.4 0 3.9 1.3 3.9 3.3 0 1.4-.7 2.5-1.9 3L14 19h-2.4l-3.3-6.8H6.2V19H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M16 19V8.5M16 5.5v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  guide: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <path
        d="M6 4h12a2 2 0 0 1 2 2v14l-5-3-5 3-5-3-5 3V6a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.9-1.2 1.6V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 17.5v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  compute: (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.navIconSvg}>
      <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M7 10h2M11 10h2M15 10h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export default function SidebarNavIcon({ name }: { name: IconName }) {
  return <span className={styles.navIcon}>{paths[name]}</span>;
}
