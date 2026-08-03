/**
 * Data provider selection.
 *
 * Supabase when configured, bundled city export otherwise. The app never
 * branches on which one is active — that's the whole point of DataSource.
 */

import { LocalSource } from './localSource';
import { SupabaseSource, hasSupabase, supabase } from './supabaseSource';
import type { DataSource } from './types';

// Bundled exports from pipeline/export_app_data.py — one per scraped city.
// Only the home city parses at startup; the rest hydrate on first use (a
// query near them, a city hop, or a deep link), keeping cold start flat as
// more cities ship.
import faisalabad from '../../assets/data/faisalabad.json';

let instance: DataSource | null = null;
let localInstance: LocalSource | null = null;

export function getLocalSource(): LocalSource {
  if (!localInstance) {
    localInstance = new LocalSource(faisalabad as any, [
      {
        name: 'islamabad-rawalpindi',
        center: { lat: 33.646, lng: 73.056 },   // between the twin cities
        state: 'idle',
        load: async () =>
          (await import('../../assets/data/islamabad-rawalpindi.json')).default as any,
      },
      {
        name: 'lahore',
        center: { lat: 31.5204, lng: 74.3587 },
        state: 'idle',
        load: async () =>
          (await import('../../assets/data/lahore.json')).default as any,
      },
    ]);
  }
  return localInstance;
}

export function getDataSource(): DataSource {
  if (!instance) {
    instance = hasSupabase && supabase ? new SupabaseSource(supabase) : getLocalSource();
  }
  return instance;
}

export const isCloudBacked = hasSupabase;

export * from './types';
export * from './search';
