import { supabase } from './supabase';

export interface EventSolutionCategoryRow {
  id: string;
  event_id: string;
  form_id: string;
  category_name: string;
  display_order: number;
  is_hidden?: boolean;
  is_default?: boolean;
  audience?: string;
}

function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

/** Copy solution category checklist rows between forms. Merge mode preserves target-only categories. */
export async function copySolutionCategoriesBetweenForms(
  sourceFormId: string,
  targetFormId: string,
  eventId: string,
  targetAudience: 'attendee' | 'vendor' = 'attendee',
  options?: { mode?: 'replace' | 'merge' },
): Promise<number> {
  if (sourceFormId === targetFormId) return 0;

  const { data: sourceRows, error: sourceErr } = await supabase
    .from('event_solution_categories')
    .select('*')
    .eq('form_id', sourceFormId)
    .order('display_order', { ascending: true })
    .order('category_name', { ascending: true });
  if (sourceErr) throw sourceErr;

  const source = (sourceRows ?? []) as EventSolutionCategoryRow[];

  const { data: targetRows, error: targetErr } = await supabase
    .from('event_solution_categories')
    .select('*')
    .eq('form_id', targetFormId);
  if (targetErr) throw targetErr;

  const target = (targetRows ?? []) as EventSolutionCategoryRow[];
  const targetByName = new Map(target.map((row) => [normalizeCategoryName(row.category_name), row]));
  const sourceNames = new Set(source.map((row) => normalizeCategoryName(row.category_name)));
  const mode = options?.mode ?? 'replace';
  const now = new Date().toISOString();
  let synced = 0;
  let nextDisplayOrder =
    target.length > 0 ? Math.max(...target.map((row) => row.display_order ?? 0)) + 1 : 0;

  for (const src of source) {
    const key = normalizeCategoryName(src.category_name);
    const existing = targetByName.get(key);
    if (existing) {
      if (mode === 'replace') {
        const { error: updErr } = await supabase
          .from('event_solution_categories')
          .update({
            display_order: src.display_order,
            is_hidden: src.is_hidden ?? false,
            updated_at: now,
          })
          .eq('id', existing.id);
        if (updErr) throw updErr;
      }
    } else {
      const { error: insErr } = await supabase.from('event_solution_categories').insert({
        event_id: eventId,
        form_id: targetFormId,
        audience: targetAudience,
        category_name: src.category_name,
        display_order: mode === 'merge' ? nextDisplayOrder++ : src.display_order,
        is_hidden: src.is_hidden ?? false,
        // A copied row is custom to the target form. Preserve the platform
        // default boundary enforced by the database trigger.
        is_default: false,
      });
      if (insErr) throw insErr;
    }
    synced += 1;
  }

  if (mode === 'replace') {
    const removeIds = target
      .filter((row) => !sourceNames.has(normalizeCategoryName(row.category_name)))
      .map((row) => row.id);
    if (removeIds.length > 0) {
      const { error: delErr } = await supabase.from('event_solution_categories').delete().in('id', removeIds);
      if (delErr) throw delErr;
    }
  }

  return synced;
}
