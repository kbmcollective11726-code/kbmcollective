/** Common US venue zones for agenda wall-clock, Live now, and 5-min session reminders. */
export const EVENT_TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (America/Phoenix — no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
] as const;

export const DEFAULT_EVENT_TIMEZONE = 'America/New_York';
