import type { ReactNode } from 'react';
import PortalHeroBanner from './PortalHeroBanner';
import type { PortalHeroEvent } from '../lib/portalHeroMedia';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';

interface Props {
  event: PortalHeroEvent | null;
  nav?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  mainClassName?: string;
}

export default function PortalPublicShell({ event, nav, footer, children, mainClassName }: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.portalFrame}>
        {event ? <PortalHeroBanner event={event} /> : null}
        {nav}
        <main className={mainClassName ?? styles.main}>{children}</main>
        {footer}
      </div>
    </div>
  );
}
