import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
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

  fetchEvents: () => Promise<void>;
  fetchAllEvents: () => Promise<void>; // platform admin: all events including inactive
  fetchEventByCode: (code: string) => Promise<{ event: Event | null; error: string | null }>;
  fetchMyMemberships: (userId: string) => Promise<void>;
  setCurrentEvent: (event: Event | null) => Promise<void>;
  setSearchedEvent: (event: Event | null) => void;
  loadCurrentEventFromStorage: () => Promise<void>;
  joinEvent: (eventId: string, userId: string) => Promise<{ error: string | null }>;
  refresh: (userId: string) => Promise<void>;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  allEvents: [],
  currentEvent: null,
  memberships: [],
  searchedEvent: null,
  isLoading: false,
  error: null,

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
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('is_active', true)
        .eq('event_code', trimmed)
        .maybeSingle();
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

  fetchMyMemberships: async (userId: string) => {
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

      const storedId = await AsyncStorage.getItem(CURRENT_EVENT_KEY);
      if (storedId) {
        const row = memberships.find((m) => m.event_id === storedId);
        if (row?.events) set({ currentEvent: row.events });
      }
      if (!get().currentEvent && memberships.length > 0 && memberships[0].events) {
        const event = memberships[0].events;
        set({ currentEvent: event });
        await AsyncStorage.setItem(CURRENT_EVENT_KEY, event.id);
      }
    } catch (err) {
      console.error('Fetch memberships error:', err);
    }
  },

  setCurrentEvent: async (event: Event | null) => {
    set({ currentEvent: event });
    if (event) {
      await AsyncStorage.setItem(CURRENT_EVENT_KEY, event.id);
    } else {
      await AsyncStorage.removeItem(CURRENT_EVENT_KEY);
    }
  },

  loadCurrentEventFromStorage: async () => {
    try {
      const id = await AsyncStorage.getItem(CURRENT_EVENT_KEY);
      if (!id) return;
      const { data } = await supabase.from('events').select('*').eq('id', id).single();
      if (data) set({ currentEvent: data as Event });
    } catch {
      // ignore
    }
  },

  joinEvent: async (eventId: string, userId: string) => {
    try {
      const { error } = await supabase.from('event_members').insert({
        event_id: eventId,
        user_id: userId,
        role: 'attendee',
      });
      // Already a member (duplicate key) → treat as success and just switch to this event
      if (error) {
        const isDuplicate = error.code === '23505' || /unique constraint|duplicate key/i.test(error.message);
        if (isDuplicate) {
          await get().fetchMyMemberships(userId);
          const event = get().events.find((e) => e.id === eventId) ?? get().searchedEvent;
          if (event) await get().setCurrentEvent(event);
          set({ searchedEvent: null });
          return { error: null };
        }
        return { error: error.message };
      }
      await get().fetchMyMemberships(userId);
      const event = get().events.find((e) => e.id === eventId) ?? get().searchedEvent;
      if (event) await get().setCurrentEvent(event);
      set({ searchedEvent: null });
      return { error: null };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to join' };
    }
  },

  refresh: async (userId: string) => {
    await get().fetchEvents();
    await get().fetchMyMemberships(userId);
  },
}));
