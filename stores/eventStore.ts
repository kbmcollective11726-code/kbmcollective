import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { isEventAccessible } from '../lib/eventAccess';
import type { Event, EventMember } from '../lib/types';

const CURRENT_EVENT_KEY = 'collectivelive_current_event_id';

interface EventStore {
  events: Event[];
  allEvents: Event[]; // all events (including inactive) — for platform admin only
  currentEvent: Event | null;
  memberships: EventMember[];
  searchedEvent: Event | null; // event found by code (before join)
  isLoading: boolean;
  error: string | null;
  /** When true, fetchMyMemberships will not auto-restore currentEvent (user chose "Join with event code"). */
  joiningByCode: boolean;
  /** Route to navigate back to when user taps Back on enter-code screen (e.g. "/(tabs)/home"). */
  joinByCodeFromRoute: string | null;
  /** Bump this after creating an event so the hamburger menu refetches admin status. */
  adminCheckTick: number;

  fetchEvents: () => Promise<void>;
  fetchAllEvents: () => Promise<void>; // platform admin: all events including inactive
  fetchEventByCode: (code: string) => Promise<{ event: Event | null; error: string | null }>;
  fetchMyMemberships: (userId: string, isPlatformAdmin?: boolean) => Promise<void>;
  setCurrentEvent: (event: Event | null) => Promise<void>;
  setSearchedEvent: (event: Event | null) => void;
  /** Call before setCurrentEvent(null) when user taps "Join with event code"; pass current route so Back can return there. */
  requestJoinByCode: (fromRoute?: string) => void;
  /** Cancel join-by-code, restore previous event, and return the route to navigate back to (or null). */
  cancelJoinByCode: (userId: string, isPlatformAdmin?: boolean) => Promise<string | null>;
  loadCurrentEventFromStorage: (isPlatformAdmin?: boolean) => Promise<void>;
  joinEvent: (eventId: string, userId: string) => Promise<{ error: string | null }>;
  refresh: (userId: string, isPlatformAdmin?: boolean) => Promise<void>;
  bumpAdminCheck: () => void;
  /** Call on logout so the next user never sees the previous user's event. */
  clearForLogout: () => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  allEvents: [],
  currentEvent: null,
  memberships: [],
  searchedEvent: null,
  isLoading: false,
  error: null,
  joiningByCode: false,
  joinByCodeFromRoute: null,
  adminCheckTick: 0,

  requestJoinByCode: (fromRoute?: string) =>
    set({ joiningByCode: true, joinByCodeFromRoute: fromRoute ?? null }),

  cancelJoinByCode: async (userId: string, isPlatformAdmin?: boolean): Promise<string | null> => {
    const route = get().joinByCodeFromRoute;
    set({ joiningByCode: false, joinByCodeFromRoute: null });
    await get().fetchMyMemberships(userId, isPlatformAdmin);
    return route;
  },

  fetchAllEvents: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('start_date', { ascending: false });
      if (error) throw error;
      set({ allEvents: data ?? [], isLoading: false, error: null });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to load events';
      set({ error: message, isLoading: false, allEvents: [] });
    }
  },

  fetchEventByCode: async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return { event: null, error: 'Enter an event code.' };
    set({ error: null });
    const timeoutMs = 25000;
    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Search timed out. Check your connection and try again.')), timeoutMs)
        ),
      ]);
    try {
      const query = supabase
        .from('events')
        .select('*')
        .eq('is_active', true)
        .eq('event_code', trimmed)
        .maybeSingle();
      const { data, error } = await withTimeout(query as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) return { event: null, error: error.message };
      const event = data as Event | null;
      set({ searchedEvent: event ?? null });
      return { event, error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      return { event: null, error: msg };
    }
  },

  setSearchedEvent: (event) => set({ searchedEvent: event }),

  fetchEvents: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('is_active', true)
        .order('start_date', { ascending: false });

      if (error) throw error;
      set({ events: data ?? [], isLoading: false, error: null });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to load events';
      set({
        error: message,
        isLoading: false,
      });
    }
  },

  fetchMyMemberships: async (userId: string, isPlatformAdmin?: boolean) => {
    try {
      const { data, error } = await supabase
        .from('event_members')
        .select('*, events(*)')
        .eq('user_id', userId)
        .order('joined_at', { ascending: false });

      if (error) throw error;
      type Row = EventMember & { events: Event | null };
      const memberships = (data ?? []) as Row[];
      set({ memberships });

      // New user or user with no event memberships must not see a previous user's event
      if (memberships.length === 0) {
        set({ currentEvent: null });
        await AsyncStorage.removeItem(CURRENT_EVENT_KEY);
        return;
      }

      const accessible = (e: Event | null | undefined) => isEventAccessible(e, isPlatformAdmin);
      const skipRestore = get().joiningByCode;
      const current = get().currentEvent;

      // Don't overwrite a platform admin's explicit selection of an event they're not a member of
      if (isPlatformAdmin && current && !memberships.some((m) => m.event_id === current.id)) {
        return;
      }

      if (!skipRestore) {
        const storedId = await AsyncStorage.getItem(CURRENT_EVENT_KEY);
        if (storedId) {
          const row = memberships.find((m) => m.event_id === storedId);
          if (row?.events && accessible(row.events)) {
            set({ currentEvent: row.events });
          } else if (isPlatformAdmin) {
            // Platform admin may have selected an event they're not a member of (e.g. from All events) — restore it from DB
            const { data: ev } = await supabase.from('events').select('*').eq('id', storedId).maybeSingle();
            const event = ev as Event | null;
            if (event && isEventAccessible(event, true)) {
              set({ currentEvent: event });
            }
            // else leave currentEvent as is (don't clear)
          } else {
            set({ currentEvent: null });
            await AsyncStorage.removeItem(CURRENT_EVENT_KEY);
          }
        }
        // Only auto-pick first membership when no event is set
        if (!get().currentEvent && memberships.length > 0) {
          const firstAccessible = memberships.find((m) => m.events && accessible(m.events));
          const event = firstAccessible?.events ?? memberships[0].events;
          if (event && accessible(event)) {
            set({ currentEvent: event });
            await AsyncStorage.setItem(CURRENT_EVENT_KEY, event.id);
          }
        }
      }
    } catch (err) {
      console.error('Fetch memberships error:', err);
    }
  },

  setCurrentEvent: async (event: Event | null) => {
    set({ currentEvent: event, joiningByCode: event ? false : get().joiningByCode });
    if (event) {
      await AsyncStorage.setItem(CURRENT_EVENT_KEY, event.id);
    } else {
      await AsyncStorage.removeItem(CURRENT_EVENT_KEY);
    }
  },

  loadCurrentEventFromStorage: async (isPlatformAdmin?: boolean) => {
    try {
      const id = await AsyncStorage.getItem(CURRENT_EVENT_KEY);
      if (!id) return;
      const { data } = await supabase.from('events').select('*').eq('id', id).single();
      if (data) {
        const event = data as Event;
        if (isEventAccessible(event, isPlatformAdmin)) {
          set({ currentEvent: event });
        } else {
          set({ currentEvent: null });
          await AsyncStorage.removeItem(CURRENT_EVENT_KEY);
        }
      }
    } catch {
      // ignore
    }
  },

  joinEvent: async (eventId: string, userId: string) => {
    const timeoutMs = 28000;
    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Join timed out. Check your connection and try again.')), timeoutMs)
        ),
      ]);
    try {
      const insertPromise = supabase.from('event_members').insert({
        event_id: eventId,
        user_id: userId,
        role: 'attendee',
      }) as unknown as Promise<{ error: { message: string; code?: string } | null }>;
      const { error } = await withTimeout(insertPromise);
      // Already a member (duplicate key) → treat as success and just switch to this event
      if (error) {
        const isDuplicate = error.code === '23505' || /unique constraint|duplicate key/i.test(error.message);
        if (isDuplicate) {
          await withTimeout(get().fetchMyMemberships(userId));
          const event = get().events.find((e) => e.id === eventId) ?? get().searchedEvent;
          if (event) await get().setCurrentEvent(event);
          set({ searchedEvent: null });
          return { error: null };
        }
        return { error: error.message };
      }
      await withTimeout(get().fetchMyMemberships(userId));
      const event = get().events.find((e) => e.id === eventId) ?? get().searchedEvent;
      if (event) await get().setCurrentEvent(event);
      set({ searchedEvent: null });
      return { error: null };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to join' };
    }
  },

  refresh: async (userId: string, isPlatformAdmin?: boolean) => {
    await get().fetchEvents();
    await get().fetchMyMemberships(userId, isPlatformAdmin);
  },

  bumpAdminCheck: () => set((s) => ({ adminCheckTick: (s.adminCheckTick ?? 0) + 1 })),

  clearForLogout: () => {
    set({ currentEvent: null, memberships: [], searchedEvent: null, joiningByCode: false, joinByCodeFromRoute: null });
    AsyncStorage.removeItem(CURRENT_EVENT_KEY).catch(() => {});
  },
}));
