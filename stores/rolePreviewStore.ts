import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RolePreviewKind } from '../lib/rolePreview';

const STORAGE_KEY = 'kbm_role_preview_kind';

function isStoredRole(value: string | null): value is RolePreviewKind {
  return value === 'off' || value === 'attendee' || value === 'speaker' || value === 'vendor' || value === 'admin';
}

interface RolePreviewStore {
  previewRole: RolePreviewKind;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPreviewRole: (role: RolePreviewKind) => Promise<void>;
  resetPreview: () => Promise<void>;
}

export const useRolePreviewStore = create<RolePreviewStore>((set) => ({
  previewRole: 'off',
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (isStoredRole(stored) && stored !== 'off') {
        set({ previewRole: stored, hydrated: true });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },

  setPreviewRole: async (role) => {
    set({ previewRole: role });
    try {
      if (role === 'off') await AsyncStorage.removeItem(STORAGE_KEY);
      else await AsyncStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* ignore */
    }
  },

  resetPreview: async () => {
    set({ previewRole: 'off' });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));
