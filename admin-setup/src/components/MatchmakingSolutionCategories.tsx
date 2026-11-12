import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { DEFAULT_SOLUTION_CATEGORIES, LEGACY_DEFAULT_SOLUTION_CATEGORIES, solutionCategoryAudienceForForm } from '../lib/defaultSolutionCategories';
import type { MatchmakingAudience } from '../lib/types';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import styles from '../pages/EventMatchmaking.module.css';

export interface SolutionCategory {
  id: string;
  event_id: string;
  form_id: string;
  category_name: string;
  display_order: number;
  is_hidden?: boolean;
  is_default?: boolean;
  audience?: string;
}

interface Props {
  eventId: string;
  formId: string;
  audience: MatchmakingAudience;
  /** When true, shorter intro (shown inside Solution interest section). */
  compact?: boolean;
}

export default function MatchmakingSolutionCategories({ eventId, formId, audience, compact = false }: Props) {
  const categoryAudience = solutionCategoryAudienceForForm(audience);
  const audienceLabel = categoryAudience === 'vendor' ? 'vendor' : 'delegate';
  const [categories, setCategories] = useState<SolutionCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [newAsDefault, setNewAsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: qErr } = await supabase
      .from('event_solution_categories')
      .select('*')
      .eq('event_id', eventId)
      .eq('form_id', formId)
      .order('display_order', { ascending: true })
      .order('category_name', { ascending: true });
    if (qErr) setError(postgrestErrorMessage(qErr));
    else setCategories((data as SolutionCategory[]) ?? []);
    setLoading(false);
  }, [eventId, formId]);

  const ensureDefaults = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from('event_solution_categories')
      .select('id, category_name, is_default, is_hidden, display_order')
      .eq('event_id', eventId)
      .eq('form_id', formId);
    if (qErr) throw qErr;
    const rows = (data ?? []) as Array<{
      id: string;
      category_name: string;
      is_default?: boolean;
      is_hidden?: boolean;
      display_order: number;
    }>;
    const keepNames = new Set(DEFAULT_SOLUTION_CATEGORIES.map((name) => name.toLowerCase()));
    const legacyNames = new Set(
      LEGACY_DEFAULT_SOLUTION_CATEGORIES.map((name) => name.toLowerCase()),
    );

    // Remove only the old HR-centric starter set (not admin-added custom categories).
    const legacyIds = rows
      .filter((r) => legacyNames.has(r.category_name.trim().toLowerCase()))
      .map((r) => r.id);
    if (legacyIds.length > 0) {
      const { error: delErr } = await supabase.from('event_solution_categories').delete().in('id', legacyIds);
      if (delErr) throw delErr;
    }

    const existingKeep = new Set(
      rows
        .filter((r) => keepNames.has(r.category_name.trim().toLowerCase()))
        .map((r) => r.category_name.trim().toLowerCase()),
    );

    const toInsert = DEFAULT_SOLUTION_CATEGORIES.filter((name) => !existingKeep.has(name.toLowerCase())).map(
      (name, index) => ({
        event_id: eventId,
        form_id: formId,
        audience: categoryAudience,
        category_name: name,
        display_order: index,
        is_default: true,
        is_hidden: false,
      }),
    );
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from('event_solution_categories').insert(toInsert);
      if (insErr) throw insErr;
    }

    // Sync display order for starter names only — do not overwrite is_default / is_hidden
    // so platform admins can demote or hide without the next load undoing it.
    const { data: refreshed, error: refreshErr } = await supabase
      .from('event_solution_categories')
      .select('id, category_name, display_order')
      .eq('event_id', eventId)
      .eq('form_id', formId);
    if (refreshErr) throw refreshErr;
    for (const [index, name] of DEFAULT_SOLUTION_CATEGORIES.entries()) {
      const row = ((refreshed ?? []) as Array<{ id: string; category_name: string; display_order: number }>).find(
        (r) => r.category_name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (!row || row.display_order === index) continue;
      const { error: updErr } = await supabase
        .from('event_solution_categories')
        .update({
          display_order: index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updErr) throw updErr;
    }
  }, [eventId, formId, categoryAudience]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const platform = await isCurrentUserPlatformAdmin();
        if (!cancelled) setIsPlatformAdmin(platform);
        // Creating/deleting default rows is platform-admin-only at the
        // database layer. Event admins can still manage custom categories.
        if (platform) await ensureDefaults();
        if (!cancelled) await load();
      } catch (e) {
        if (!cancelled) {
          setError(postgrestErrorMessage(e) || 'Could not load solution categories');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureDefaults, load]);

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const order = categories.length > 0 ? Math.max(...categories.map((c) => c.display_order)) + 1 : 0;
      const { error: insErr } = await supabase.from('event_solution_categories').insert({
        event_id: eventId,
        form_id: formId,
        audience: categoryAudience,
        category_name: name,
        display_order: order,
        is_default: isPlatformAdmin && newAsDefault,
        is_hidden: false,
      });
      if (insErr) throw insErr;
      setNewName('');
      setNewAsDefault(false);
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not add category');
    } finally {
      setBusy(false);
    }
  };

  const moveCategory = async (id: string, direction: -1 | 1) => {
    const index = categories.findIndex((c) => c.id === id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= categories.length) return;
    const a = categories[index];
    const b = categories[swapIndex];
    if (!a || !b) return;
    setBusy(true);
    setError('');
    try {
      const { error: errA } = await supabase
        .from('event_solution_categories')
        .update({ display_order: b.display_order, updated_at: new Date().toISOString() })
        .eq('id', a.id);
      if (errA) throw errA;
      const { error: errB } = await supabase
        .from('event_solution_categories')
        .update({ display_order: a.display_order, updated_at: new Date().toISOString() })
        .eq('id', b.id);
      if (errB) throw errB;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not reorder category');
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (row: SolutionCategory) => {
    setBusy(true);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('event_solution_categories')
        .update({ is_hidden: !row.is_hidden, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updErr) throw updErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update category visibility');
    } finally {
      setBusy(false);
    }
  };

  const toggleDefault = async (row: SolutionCategory) => {
    if (!isPlatformAdmin) {
      setError('Only a platform admin can change default status.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('event_solution_categories')
        .update({ is_default: !row.is_default, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updErr) throw updErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update default status');
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (row: SolutionCategory) => {
    if (row.is_default && !isPlatformAdmin) {
      setError('Default solution categories can be hidden, but only a platform admin can delete them.');
      return;
    }
    if (!window.confirm(`Remove "${row.category_name}" from this event?`)) return;
    setBusy(true);
    setError('');
    try {
      const { error: delErr } = await supabase.from('event_solution_categories').delete().eq('id', row.id);
      if (delErr) throw delErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not delete category');
    } finally {
      setBusy(false);
    }
  };

  const bulkSetHidden = async (ids: string[], hidden: boolean) => {
    if (ids.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const { error: updErr } = await supabase
        .from('event_solution_categories')
        .update({ is_hidden: hidden, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (updErr) throw updErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not update categories');
    } finally {
      setBusy(false);
    }
  };

  const bulkShowAll = () => {
    const ids = categories.map((c) => c.id);
    if (!window.confirm(`Show all ${ids.length} categories on registration forms?`)) return;
    void bulkSetHidden(ids, false);
  };

  const bulkHideAll = () => {
    const ids = categories.map((c) => c.id);
    if (!window.confirm(`Hide all ${ids.length} categories from registration forms?`)) return;
    void bulkSetHidden(ids, true);
  };

  const bulkShowDefaultsOnly = () => {
    const defaultIds = categories.filter((c) => c.is_default).map((c) => c.id);
    const customIds = categories.filter((c) => !c.is_default).map((c) => c.id);
    if (defaultIds.length === 0) {
      setError('No default categories on this event.');
      return;
    }
    if (
      !window.confirm(
        `Show ${defaultIds.length} default categor${defaultIds.length === 1 ? 'y' : 'ies'} and hide ${customIds.length} custom?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        if (defaultIds.length > 0) {
          const { error: showErr } = await supabase
            .from('event_solution_categories')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .in('id', defaultIds);
          if (showErr) throw showErr;
        }
        if (customIds.length > 0) {
          const { error: hideErr } = await supabase
            .from('event_solution_categories')
            .update({ is_hidden: true, updated_at: new Date().toISOString() })
            .in('id', customIds);
          if (hideErr) throw hideErr;
        }
        await load();
      } catch (e) {
        setError(postgrestErrorMessage(e) || 'Could not update categories');
      } finally {
        setBusy(false);
      }
    })();
  };

  const bulkDeleteCustom = () => {
    const custom = categories.filter((c) => !c.is_default);
    if (custom.length === 0) {
      setError('No custom categories to delete.');
      return;
    }
    if (
      !window.confirm(
        `Delete ${custom.length} custom categor${custom.length === 1 ? 'y' : 'ies'}? Default categories are kept.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const { error: delErr } = await supabase
          .from('event_solution_categories')
          .delete()
          .in(
            'id',
            custom.map((c) => c.id),
          );
        if (delErr) throw delErr;
        await load();
      } catch (e) {
        setError(postgrestErrorMessage(e) || 'Could not delete custom categories');
      } finally {
        setBusy(false);
      }
    })();
  };

  const resetToKbmDefaults = () => {
    if (!isPlatformAdmin) {
      setError('Only a platform admin can reset to KBM defaults.');
      return;
    }
    if (
      !window.confirm(
        'Restore missing KBM default categories, remove legacy HR starter names, and show all default categories?',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        await ensureDefaults();
        const { data, error: qErr } = await supabase
          .from('event_solution_categories')
          .select('id')
          .eq('event_id', eventId)
          .eq('form_id', formId)
          .eq('is_default', true);
        if (qErr) throw qErr;
        const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
        if (ids.length > 0) {
          const { error: showErr } = await supabase
            .from('event_solution_categories')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .in('id', ids);
          if (showErr) throw showErr;
        }
        await load();
      } catch (e) {
        setError(postgrestErrorMessage(e) || 'Could not reset categories');
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading) return <p className={styles.hint}>Loading solution categories…</p>;

  return (
    <div>
      <p className={styles.hint}>
        {compact
          ? 'Choices for this form only. Other forms (even another delegate track) have their own list — duplicate a form or use Copy from delegate to sync.'
          : `Default categories seed on this form only. Other ${audienceLabel} forms are separate. Duplicate a form or use Copy from delegate to mirror another checklist.`}{' '}
        Custom categories can be added and deleted by event admins.
        {isPlatformAdmin
          ? ' As a platform admin, you can mark categories as default or remove default status.'
          : null}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.inlineForm}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          style={{ minWidth: 240 }}
        />
        {isPlatformAdmin ? (
          <label className={styles.checkboxInline}>
            <input
              type="checkbox"
              checked={newAsDefault}
              onChange={(e) => setNewAsDefault(e.target.checked)}
            />
            Mark as default
          </label>
        ) : null}
        <button type="button" onClick={() => void addCategory()} disabled={busy || !newName.trim()}>
          Add category
        </button>
      </div>
      {categories.length > 0 ? (
        <div className={styles.categoryBulkBar}>
          <span className={styles.categoryBulkLabel}>Manage all</span>
          <button type="button" className={styles.btnSecondary} onClick={bulkShowAll} disabled={busy}>
            Show all
          </button>
          <button type="button" className={styles.btnSecondary} onClick={bulkHideAll} disabled={busy}>
            Hide all
          </button>
          <button type="button" className={styles.btnSecondary} onClick={bulkShowDefaultsOnly} disabled={busy}>
            Show defaults only
          </button>
          <button type="button" className={styles.btnDangerOutline} onClick={bulkDeleteCustom} disabled={busy}>
            Delete all custom
          </button>
          {isPlatformAdmin ? (
            <button type="button" className={styles.btnSecondary} onClick={resetToKbmDefaults} disabled={busy}>
              Reset KBM defaults
            </button>
          ) : null}
        </div>
      ) : null}
      {categories.length === 0 ? (
        <p className={styles.hint}>No categories yet. Defaults will appear after reload.</p>
      ) : (
        <ul className={styles.optionList}>
          {categories.map((c, index) => (
            <li key={c.id} className={c.is_hidden ? styles.categoryRowHidden : undefined}>
              <span className={styles.categoryRowLabel}>
                {c.category_name}
                {c.is_default ? <span className={styles.baseTag}>default</span> : null}
                {c.is_hidden ? <span className={styles.hiddenPill}>Hidden</span> : null}
              </span>
              <span className={styles.categoryRowActions}>
                <button
                  type="button"
                  className={styles.btnIcon}
                  onClick={() => void moveCategory(c.id, -1)}
                  disabled={busy || index === 0}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.btnIcon}
                  onClick={() => void moveCategory(c.id, 1)}
                  disabled={busy || index === categories.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" className={styles.btnSecondary} onClick={() => void toggleHidden(c)} disabled={busy}>
                  {c.is_hidden ? 'Show' : 'Hide'}
                </button>
                {isPlatformAdmin ? (
                  <button type="button" className={styles.btnSecondary} onClick={() => void toggleDefault(c)} disabled={busy}>
                    {c.is_default ? 'Unset default' : 'Make default'}
                  </button>
                ) : null}
                {!c.is_default || isPlatformAdmin ? (
                  <button type="button" className={styles.btnDangerOutline} onClick={() => void removeCategory(c)} disabled={busy}>
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
