import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface BlockStore {
  blockedUserIds: Set<string>;
  isLoading: boolean;
  fetchBlockedUsers: (userId: string) => Promise<void>;
  blockUser: (blockerId: string, blockedUserId: string) => Promise<{ error: string | null }>;
  unblockUser: (blockerId: string, blockedUserId: string) => Promise<{ error: string | null }>;
  isBlocked: (userId: string) => boolean;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blockedUserIds: new Set(),
  isLoading: false,

  fetchBlockedUsers: async (userId: string) => {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('blocked_users')
        .select('blocked_user_id')
        .eq('blocker_id', userId);
      if (error) throw error;
      const ids = new Set((data ?? []).map((r) => r.blocked_user_id));
      set({ blockedUserIds: ids });
    } catch {
      // Table may not exist yet — run scripts/migrate-block-report.sql in Supabase
      set({ blockedUserIds: new Set() });
    } finally {
      set({ isLoading: false });
    }
  },

  blockUser: async (blockerId: string, blockedUserId: string) => {
    try {
      const { error } = await supabase.from('blocked_users').insert({
        blocker_id: blockerId,
        blocked_user_id: blockedUserId,
      });
      if (error) return { error: error.message };
      set((s) => ({
        blockedUserIds: new Set([...s.blockedUserIds, blockedUserId]),
      }));
      return { error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to block';
      return { error: msg };
    }
  },

  unblockUser: async (blockerId: string, blockedUserId: string) => {
    try {
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_user_id', blockedUserId);
      if (error) return { error: error.message };
      set((s) => {
        const next = new Set(s.blockedUserIds);
        next.delete(blockedUserId);
        return { blockedUserIds: next };
      });
      return { error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unblock';
      return { error: msg };
    }
  },

  isBlocked: (userId: string) => get().blockedUserIds.has(userId),
}));
