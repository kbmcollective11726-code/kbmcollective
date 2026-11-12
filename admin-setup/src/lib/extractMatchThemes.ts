import { supabase } from './supabase';

export async function isMatchAiThemesEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_match_ai_themes_enabled');
  if (error) return false;
  return data === true;
}

export async function setMatchAiThemesEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_match_ai_themes_enabled', {
    p_enabled: enabled,
  });
  if (error) throw error;
}

/** Fire-and-forget open-text theme extraction for one submission (non-blocking). */
export function requestMatchThemeExtraction(submissionId: string): void {
  if (!submissionId) return;
  void (async () => {
    const enabled = await isMatchAiThemesEnabled();
    if (!enabled) return;
    await supabase.functions.invoke('extract-match-themes', {
      body: { submission_id: submissionId },
    });
  })().catch(() => {
    /* non-blocking — scoring falls back to word overlap */
  });
}

/** Admin/event backfill of open-text themes. */
export async function extractMatchThemesForEvent(
  eventId: string,
  opts?: { limit?: number; force?: boolean },
): Promise<{ processed: number; skippedNoKey: number; error?: string; disabled?: boolean }> {
  const enabled = await isMatchAiThemesEnabled();
  if (!enabled) {
    return { processed: 0, skippedNoKey: 0, disabled: true, error: 'AI open-text themes are disabled' };
  }
  const { data, error } = await supabase.functions.invoke('extract-match-themes', {
    body: {
      event_id: eventId,
      limit: opts?.limit ?? 40,
      force: opts?.force === true,
    },
  });
  if (error) {
    return { processed: 0, skippedNoKey: 0, error: error.message };
  }
  const payload = data as {
    processed?: number;
    skipped_no_key?: number;
    error?: string;
    reason?: string;
  } | null;
  if (payload?.reason === 'feature_disabled') {
    return { processed: 0, skippedNoKey: 0, disabled: true, error: payload.error };
  }
  if (payload?.error && payload.processed == null) {
    return { processed: 0, skippedNoKey: 0, error: payload.error };
  }
  return {
    processed: payload?.processed ?? 0,
    skippedNoKey: payload?.skipped_no_key ?? 0,
  };
}
