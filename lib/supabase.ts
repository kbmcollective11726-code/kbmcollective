import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Load from .env (create from .env.example). Restart Expo after changing .env.
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

// Use placeholders if missing so the app loads in Expo Go; auth will fail until .env is set.
const url = SUPABASE_URL || 'https://placeholder.supabase.co';
const key = SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
