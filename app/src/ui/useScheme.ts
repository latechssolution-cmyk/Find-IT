/**
 * Light / dark resolution, with a user override.
 *
 * Following the OS is the right default, but it must not be the only option:
 * plenty of people run their phone dark and still want a document-like app
 * light, and on cheap LCD panels (the bulk of this market) the warm cream
 * palette is simply more legible than the dark one.
 *
 * Preference is persisted, and reads synchronously from an in-memory cache
 * after first load so there's no flash of the wrong theme on navigation.
 */

import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { create } from '../hooks/store';
import type { Scheme } from '../theme';

const KEY = 'findit.theme.v1';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate(): Promise<void>;
  setMode(m: ThemeMode): Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    try {
      const v = (await AsyncStorage.getItem(KEY)) as ThemeMode | null;
      set({ mode: v ?? 'system', hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  async setMode(m) {
    set({ mode: m });
    try { await AsyncStorage.setItem(KEY, m); } catch { /* preference only */ }
  },
}));

/** The single place the app asks "light or dark?". */
export function useScheme(): Scheme {
  const os = (useColorScheme() ?? 'light') as Scheme;
  const { mode } = useThemeStore();
  return mode === 'system' ? os : mode;
}

/** Call once at the root so the stored preference is loaded before first paint. */
export function useThemeBootstrap() {
  const store = useThemeStore();
  useEffect(() => { store.hydrate(); /* eslint-disable-next-line */ }, []);
  return store.hydrated;
}
