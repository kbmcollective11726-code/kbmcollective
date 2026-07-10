/**
 * Short UI chimes via Web Audio (no asset files).
 */
export type WallSoundKind = 'leader' | 'like' | 'milestone' | 'spotlight';

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playWallSound(kind: WallSoundKind, enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  const t = ctx.currentTime;
  switch (kind) {
    case 'like':
      tone(520, t, 0.12, 0.08);
      break;
    case 'leader':
      tone(392, t, 0.18, 0.1);
      tone(523, t + 0.12, 0.22, 0.09);
      tone(659, t + 0.28, 0.3, 0.08);
      break;
    case 'milestone':
      tone(440, t, 0.15, 0.09);
      tone(554, t + 0.1, 0.2, 0.08);
      break;
    case 'spotlight':
      tone(330, t, 0.25, 0.07);
      break;
    default:
      break;
  }
}
