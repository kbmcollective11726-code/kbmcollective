/** Fetch all approved wall posts for an event via hardened live-wall RPC. */

const PAGE_SIZE = 200;

export const WALL_POSTS_SELECT =
  'id, image_url, caption, likes_count, comments_count, created_at, user:users(full_name)';

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function asPostArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    // Rare PostgREST shape: jsonb decoded oddly
    const values = Object.values(data as Record<string, unknown>);
    if (values.length && values.every((v) => v && typeof v === 'object' && 'id' in (v as object))) {
      return values as any[];
    }
  }
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function fetchAllWallPosts(
  client: RpcClient | null,
  eventId: string,
): Promise<any[]> {
  if (!client || !eventId) return [];

  const all: any[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.rpc('get_live_wall_posts', {
      p_event_id: eventId,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (error) {
      console.error('[live-wall] fetchAllWallPosts', error);
      break;
    }
    const page = asPostArray(data);
    if (!page.length) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}
