'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WallHeartBurst, WallHeroEvent } from '../lib/wallEngagement';

const CHAMPAGNE = '#c9a961';
const CHAMPAGNE_SOFT = '#d4b574';
const NAVY = '#1a2332';

interface WallEngagementLayerProps {
  hero: WallHeroEvent | null;
  hearts: WallHeartBurst[];
  soundEnabled: boolean;
  effectsEnabled: boolean;
  onToggleSound: () => void;
  showPhotoOfHourBadge?: boolean;
}

function ConfettiBurst({ active, intense }: { active: boolean; intense?: boolean }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: intense ? 72 : 48 }, (_, i) => ({
        id: i,
        left: `${(i * 17) % 100}%`,
        delay: `${(i % 8) * 0.04}s`,
        color: i % 3 === 0 ? CHAMPAGNE : i % 3 === 1 ? CHAMPAGNE_SOFT : '#f8f9fa',
        rotate: `${(i * 47) % 360}deg`,
        size: 6 + (i % 4) * 2,
      })),
    [],
  );

  if (!active) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 9000,
      }}
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: p.left,
            top: '-12px',
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            borderRadius: 1,
            opacity: 0.9,
            animation: `wall-confetti-fall 2.8s ease-in ${p.delay} forwards`,
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
    </div>
  );
}

function HeroBanner({ hero }: { hero: WallHeroEvent }) {
  const isSpotlight = hero.kind === 'comment_spotlight';
  const isPhotoOfHour = hero.kind === 'photo_of_hour';
  const isCenter = isSpotlight || isPhotoOfHour;
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        top: isCenter ? '50%' : 88,
        transform: isCenter ? 'translate(-50%, -50%)' : 'translateX(-50%)',
        zIndex: 9100,
        pointerEvents: 'none',
        maxWidth: isCenter ? 'min(760px, 92vw)' : 'min(560px, 90vw)',
        textAlign: 'center',
        animation: isPhotoOfHour ? 'wall-hero-photo-hour 0.55s ease-out' : 'wall-hero-in 0.45s ease-out',
      }}
    >
      <div
        style={{
          background: isPhotoOfHour
            ? 'linear-gradient(135deg, rgba(201,169,97,0.22), rgba(26,35,50,0.96))'
            : isSpotlight
              ? 'rgba(26, 35, 50, 0.94)'
              : 'linear-gradient(135deg, rgba(45,62,80,0.97), rgba(26,35,50,0.97))',
          border: `${isPhotoOfHour ? 3 : 2}px solid ${CHAMPAGNE}`,
          borderRadius: isCenter ? 18 : 12,
          padding: isPhotoOfHour ? '32px 36px' : isSpotlight ? '28px 32px' : '16px 28px',
          boxShadow: isPhotoOfHour
            ? '0 0 60px rgba(201,169,97,0.35), 0 20px 56px rgba(0,0,0,0.5)'
            : '0 16px 48px rgba(0,0,0,0.45)',
        }}
      >
        {!isSpotlight && (
          <div
            style={{
              fontSize: isPhotoOfHour ? 12 : 10,
              fontWeight: 700,
              letterSpacing: '0.22em',
              color: CHAMPAGNE,
              marginBottom: isPhotoOfHour ? 10 : 6,
              textTransform: 'uppercase',
            }}
          >
            {hero.kind === 'new_leader'
              ? 'New leader'
              : hero.kind === 'milestone'
                ? 'Milestone'
                : hero.kind === 'first_photo'
                  ? 'First photo'
                  : hero.kind === 'photo_of_hour'
                    ? 'Photo of the hour'
                    : 'Live moment'}
          </div>
        )}
        <div
          style={{
            fontSize: isPhotoOfHour ? 32 : isSpotlight ? 26 : 22,
            fontWeight: 700,
            color: '#f8f9fa',
            lineHeight: 1.25,
          }}
        >
          {isPhotoOfHour ? `🏆 ${hero.title}` : hero.title}
        </div>
        {hero.subtitle ? (
          <div style={{ marginTop: 8, fontSize: isSpotlight ? 16 : 14, color: 'rgba(248,249,250,0.75)' }}>
            {hero.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WallHeartBursts({ hearts }: { hearts: WallHeartBurst[] }) {
  return (
    <>
      {hearts.map((h, i) => (
        <span
          key={h.id}
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '42%',
            transform: 'translate(-50%, -50%)',
            fontSize: 72 + i * 8,
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 20,
            animation: 'wall-heart-burst 1.5s ease-out forwards',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.35))',
          }}
        >
          ❤️
        </span>
      ))}
    </>
  );
}

export function PhotoOfHourBadge() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 15,
        background: 'rgba(201, 169, 97, 0.92)',
        color: NAVY,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.12em',
        padding: '6px 10px',
        borderRadius: 6,
        textTransform: 'uppercase',
      }}
    >
      Photo of the hour
    </div>
  );
}

export default function WallEngagementLayer({
  hero,
  hearts,
  soundEnabled,
  effectsEnabled,
  onToggleSound,
}: WallEngagementLayerProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (hero?.confetti) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hero?.id, hero?.confetti]);

  if (!effectsEnabled) return null;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes wall-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes wall-hero-in {
          0% { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.96); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes wall-hero-photo-hour {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.88); }
          60% { opacity: 1; transform: translate(-50%, -50%) scale(1.03); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes wall-heart-burst {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(1.35); }
        }
        @keyframes wall-rank-glow {
          0%, 100% { box-shadow: none; background: transparent; }
          50% { box-shadow: 0 0 0 2px rgba(201,169,97,0.55); background: rgba(201,169,97,0.12); }
        }
        .wall-rank-highlight {
          animation: wall-rank-glow 1.2s ease-in-out 2;
          border-radius: 8px;
        }
      `,
        }}
      />
      <ConfettiBurst active={showConfetti} intense={hero?.kind === 'photo_of_hour'} />
      {hero ? <HeroBanner hero={hero} /> : null}
      <button
        type="button"
        onClick={onToggleSound}
        title={soundEnabled ? 'Mute wall sounds' : 'Enable wall sounds'}
        style={{
          position: 'fixed',
          bottom: 56,
          right: 12,
          zIndex: 8800,
          border: '1px solid rgba(201, 169, 97, 0.45)',
          background: 'rgba(34, 43, 58, 0.9)',
          color: CHAMPAGNE,
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '0.06em',
        }}
      >
        {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
      </button>
    </>
  );
}

export { WallHeartBursts as WallHearts };
