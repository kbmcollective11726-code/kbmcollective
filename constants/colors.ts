export const colors = {
  // Primary brand
  primary: '#2563eb',
  primaryLight: '#3b82f6',
  primaryDark: '#1d4ed8',
  primaryFaded: '#dbeafe',

  // Secondary
  secondary: '#10b981',
  secondaryLight: '#34d399',

  // Accent
  accent: '#f59e0b',
  accentLight: '#fbbf24',

  // Status
  danger: '#ef4444',
  dangerLight: '#fca5a5',
  success: '#22c55e',
  warning: '#f59e0b',
  info: '#3b82f6',

  // Neutrals
  background: '#ffffff',
  surface: '#f8fafc',
  surfaceHover: '#f1f5f9',
  card: '#ffffff',

  // Text
  text: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textLight: '#cbd5e1',
  textOnPrimary: '#ffffff',

  // Borders
  border: '#e2e8f0',
  borderLight: '#f1f5f9',
  borderDark: '#cbd5e1',

  // Gamification
  gold: '#fbbf24',
  silver: '#9ca3af',
  bronze: '#d97706',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',

  // Shadows (for boxShadow on web / elevation on native)
  shadowColor: '#000000',
} as const;

// Session type colors for the schedule
export const sessionTypeColors: Record<string, string> = {
  keynote: '#7c3aed',
  breakout: '#2563eb',
  workshop: '#059669',
  social: '#ec4899',
  meal: '#f59e0b',
  networking: '#06b6d4',
  vendor: '#8b5cf6',
};

// Notification type icons
export const notificationIcons: Record<string, string> = {
  like: '❤️',
  comment: '💬',
  message: '✉️',
  announcement: '📢',
  points: '🏆',
  badge: '🎯',
  meeting: '🤝',
  schedule_change: '📅',
  system: 'ℹ️',
};
