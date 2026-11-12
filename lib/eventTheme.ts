import { useMemo } from 'react';
import { colors } from '../constants/colors';
import { useEventStore } from '../stores/eventStore';

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** Brand default — always blue when event has no valid theme hex. */
export const DEFAULT_EVENT_THEME_COLOR = colors.primary; // #2563eb

/** Valid #RRGGBB or fallback to brand blue. */
export function resolveEventThemeColor(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (HEX_RE.test(trimmed)) return trimmed.toLowerCase();
  return DEFAULT_EVENT_THEME_COLOR;
}

/** Current event theme hex for chrome (tabs, header icons, accents). */
export function useEventThemeColor(): string {
  const raw = useEventStore((s) => s.currentEvent?.theme_color);
  return useMemo(() => resolveEventThemeColor(raw), [raw]);
}

/** Append 2-digit hex alpha to a resolved theme color (e.g. `22` ≈ 13% opacity). */
export function themeColorWithAlpha(color: string, alphaHex = '22'): string {
  return `${color}${alphaHex}`;
}

/** Darken a resolved #RRGGBB for gradients and pressed states. */
export function darkenThemeColor(hex: string, factor = 0.82): string {
  const resolved = resolveEventThemeColor(hex);
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(resolved);
  if (!match) return colors.primaryDark;
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const r = clamp(Math.round(parseInt(match[1], 16) * factor));
  const g = clamp(Math.round(parseInt(match[2], 16) * factor));
  const b = clamp(Math.round(parseInt(match[3], 16) * factor));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
