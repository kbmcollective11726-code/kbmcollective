import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface BlockStore {
  /** Users I have blocked (I am blocker). */
  blockedUserIds: Set<string>;
  /** Users who have blocked me (they are blocker, I am blocked). */
  usersWhoBlockedMeIds: Set<string>;
  isLoading: boolean;
  fetchBlockedUsers: (userId: string) => Promise<void>;
  blockUser: (blockerId: string, blockedUserId: string) => Promise<{ error: string | null }>;
  unblockUser: (blockerId: string, blockedUserId: string) => Promise<{ error: string | null }>;
  isBlocked: (userId: string) => boolean;
  /** True if `userId` has blocked the current account (after fetch). */
  isBlockedBy: (userId: string) => boolean;
  /** Either party blocked the other — no new connect / message. */
  isInteractionBlocked: (otherUserId: string) => boolean;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blockedUserIds: new Set(),
  usersWhoBlockedMeIds: new Set(),
  isLoading: false,

  fetchBlockedUsers: async (userId: string) => {
    set({ isLoading: true });
    try {
      const [outRes, inRes] = await Promise.all([
        supabase.from('blocked_users').select('blocked_user_id').eq('blocker_id', userId),
        supabase.from('blocked_users').select('blocker_id').eq('blocked_user_id', userId),
      ]);
      if (outRes.error) throw outRes.error;
      if (inRes.error) throw inRes.error;
      const blockedUserIds = new Set((outRes.data ?? []).map((r) => r.blocked_user_id));
      const usersWhoBlockedMeIds = new Set((inRes.data ?? []).map((r) => r.blocker_id));
      set({ blockedUserIds, usersWhoBlockedMeIds });
    } catch {
      // Table may not exist yet — run scripts/migrate-block-report.sql in Supabase
      set({ blockedUserIds: new Set(), usersWhoBlockedMeIds: new Set() });
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

  isBlockedBy: (userId: string) => get().usersWhoBlockedMeIds.has(userId),

  isInteractionBlocked: (otherUserId: string) => {
    const s = get();
    return s.blockedUserIds.has(otherUserId) || s.usersWhoBlockedMeIds.has(otherUserId);
  },
}));
