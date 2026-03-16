/**
 * Debug log for development. Persists to AsyncStorage so it survives app reload.
 * When something fails or a key action happens, we add an entry. User opens Debug
 * panel and Share to copy the log for support.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_ENTRIES = 30;
const STORAGE_KEY = 'collectivelive_debug_log';

type LogEntry = {
  at: string;
  screen: string;
  message: string;
  detail?: string;
};

const entries: LogEntry[] = [];

function now(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatEntries(arr: LogEntry[]): string {
  return arr
    .map((e) => {
      const d = e.detail ? `\n  ${e.detail}` : '';
      return `[${e.at}] ${e.screen}: ${e.message}${d}`;
    })
    .join('\n');
}

function persist(): void {
  try {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (_) {}
}

export function addDebugLog(screen: string, message: string, detail?: string): void {
  entries.unshift({
    at: now(),
    screen,
    message: String(message).slice(0, 200),
    detail: detail != null ? String(detail).slice(0, 300) : undefined,
  });
  if (entries.length > MAX_ENTRIES) entries.pop();
  persist();
  if (__DEV__) {
    const line = detail ? `${screen}: ${message} | ${detail}` : `${screen}: ${message}`;
    console.warn('[DebugLog]', line);
  }
}

export function getDebugLog(): string {
  const body = entries.length > 0 ? formatEntries(entries) : '(no entries this session yet)';
  return [
    '--- CollectiveLive debug log ---',
    `Time: ${new Date().toISOString()}`,
    '',
    body,
  ].join('\n');
}

/** Call when opening Debug panel: merge persisted log so we see entries from before app reload. */
export async function getDebugLogWithPersisted(): Promise<string> {
  let persisted: LogEntry[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) persisted = JSON.parse(raw);
  } catch (_) {}
  const lines = [
    '--- CollectiveLive debug log ---',
    `Time: ${new Date().toISOString()}`,
    '',
  ];
  if (entries.length > 0) {
    lines.push(formatEntries(entries));
    lines.push('');
  }
  if (persisted.length > 0) {
    lines.push(entries.length > 0 ? '--- Previous session (before reload) ---' : '--- Last saved log ---');
    lines.push(formatEntries(persisted));
  }
  if (entries.length === 0 && persisted.length === 0) lines.push('(no entries yet — errors will appear here when a load fails or times out)');
  return lines.join('\n');
}

export function clearDebugLog(): void {
  entries.length = 0;
  persist();
}
