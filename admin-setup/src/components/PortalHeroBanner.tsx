import { useState } from 'react';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';
import {
  isWidePortalBannerImage,
  portalAppBannerCandidate,
  portalLogoCandidate,
  portalWideBannerCandidate,
  type PortalHeroEvent,
} from '../lib/portalHeroMedia';

interface Props {
  event: PortalHeroEvent;
}

type DisplayMode = 'wide' | 'logo' | 'title';

function initialDisplayMode(event: PortalHeroEvent): DisplayMode {
  if (portalWideBannerCandidate(event)) return 'wide';
  if (portalAppBannerCandidate(event)) return 'wide';
  if (portalLogoCandidate(event)) return 'logo';
  return 'title';
}

function initialImageSrc(event: PortalHeroEvent): string | null {
  return portalWideBannerCandidate(event) ?? portalAppBannerCandidate(event) ?? portalLogoCandidate(event);
}

export default function PortalHeroBanner({ event }: Props) {
  const wideCandidate = portalWideBannerCandidate(event);

  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => initialDisplayMode(event));
  const [imageSrc, setImageSrc] = useState<string | null>(() => initialImageSrc(event));

  const fallbackFromWideAttempt = () => {
    const logo = portalLogoCandidate(event);
    if (logo) {
      setDisplayMode('logo');
      setImageSrc(logo);
      return;
    }
    setDisplayMode('title');
    setImageSrc(null);
  };

  if (displayMode === 'title' || !imageSrc) {
    return (
      <header className={styles.hero}>
        <div className={styles.heroBannerInner}>
          <p className={styles.heroEventTitle}>{event.name}</p>
        </div>
      </header>
    );
  }

  if (displayMode === 'wide') {
    return (
      <header className={`${styles.hero} ${styles.heroWide}`}>
        <div className={styles.heroWideFrame}>
          <img
            src={imageSrc}
            alt=""
            className={styles.heroImageWide}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (wideCandidate || isWidePortalBannerImage(img.naturalWidth, img.naturalHeight)) {
                return;
              }
              fallbackFromWideAttempt();
            }}
            onError={fallbackFromWideAttempt}
          />
        </div>
      </header>
    );
  }

  return (
    <header className={styles.hero}>
      <div className={styles.heroBrandRow}>
        <img src={imageSrc} alt="" className={styles.heroBrandMark} />
        <p className={styles.heroEventTitle}>{event.name}</p>
      </div>
    </header>
  );
}
