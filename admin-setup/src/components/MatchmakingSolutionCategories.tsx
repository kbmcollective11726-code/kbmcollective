import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import styles from '../pages/EventMatchmaking.module.css';

export interface SolutionCategory {
  id: string;
  event_id: string;
  category_name: string;
  display_order: number;
}

interface Props {
  eventId: string;
}

export default function MatchmakingSolutionCategories({ eventId }: Props) {
  const [categories, setCategories] = useState<SolutionCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: qErr } = await supabase
      .from('event_solution_categories')
      .select('*')
      .eq('event_id', eventId)
      .order('display_order', { ascending: true })
      .order('category_name', { ascending: true });
    if (qErr) setError(postgrestErrorMessage(qErr));
    else setCategories((data as SolutionCategory[]) ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const order = categories.length > 0 ? Math.max(...categories.map((c) => c.display_order)) + 1 : 0;
      const { error: insErr } = await supabase.from('event_solution_categories').insert({
        event_id: eventId,
        category_name: name,
        display_order: order,
      });
      if (insErr) throw insErr;
      setNewName('');
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not add category');
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (id: string) => {
    if (!window.confirm('Remove this solution category? Existing selections are preserved on submissions.')) return;
    setBusy(true);
    try {
      const { error: delErr } = await supabase.from('event_solution_categories').delete().eq('id', id);
      if (delErr) throw delErr;
      await load();
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not delete category');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className={styles.hint}>Loading solution categories…</p>;

  return (
    <div>
      <p className={styles.hint}>
        One shared list for delegate &quot;Solution Category of Interest&quot; and vendor &quot;Category You Offer&quot;. Used by
        match scoring. Add industry/solution types (e.g. Technologies, Culture &amp; Engagement) — not Meeting Goals answers.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.inlineForm}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          style={{ minWidth: 240 }}
        />
        <button type="button" onClick={() => void addCategory()} disabled={busy || !newName.trim()}>
          Add category
        </button>
      </div>
      {categories.length === 0 ? (
        <p className={styles.hint}>No categories yet. Add categories before opening Stage 2 registration.</p>
      ) : (
        <ul className={styles.optionList}>
          {categories.map((c) => (
            <li key={c.id}>
              {c.category_name}
              <button type="button" onClick={() => void removeCategory(c.id)} disabled={busy} style={{ marginLeft: 8 }}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
