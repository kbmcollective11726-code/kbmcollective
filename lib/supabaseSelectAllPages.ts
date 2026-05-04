/**
 * Repeatedly queries with .range(from, to) until a page returns fewer than pageSize rows.
 * Use for loading full result sets beyond PostgREST default limits.
 */
const DEFAULT_PAGE_SIZE = 300;

type PageResult<T> = { data: T[] | null; error: { message?: string } | null };

export async function selectAllInPages<T>(
  pageSize: number,
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export function chunkIds<T>(ids: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

export const SUPABASE_SELECT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
