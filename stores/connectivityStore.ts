import { create } from 'zustand';
import { looksLikeConnectivityOutage } from '../lib/requestFailure';

type ConnectivityState = {
  /** True when recent API/network calls failed. */
  isOffline: boolean;
  /** True when UI is showing cached agenda/event/rank/1:1/community because live fetch failed. */
  showingCachedData: boolean;
  reportSuccess: () => void;
  reportFailure: (err?: unknown) => void;
  setShowingCachedData: (value: boolean) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOffline: false,
  showingCachedData: false,

  reportSuccess: () => set({ isOffline: false, showingCachedData: false }),

  reportFailure: (err?: unknown) => {
    if (looksLikeConnectivityOutage(err)) {
      set({ isOffline: true });
    }
  },

  setShowingCachedData: (value) => set({ showingCachedData: value }),
}));
