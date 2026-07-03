import styles from './Layout.module.css';

type IconName = 'events' | 'users' | 'audit' | 'guide';

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
};

export default function SidebarNavIcon({ name }: { name: IconName }) {
  return <span className={styles.navIcon}>{paths[name]}</span>;
}
