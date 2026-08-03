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

/**
 * Cloud with the bundle as a live fallback — the PRD's offline tier, made
 * real. On this market's networks a request that blinks is Tuesday; a failed
 * cloud call must degrade to bundled results, never to "Nothing here yet"
 * (which reads as "your city is missing", the worst possible lie).
 */
class ResilientSource implements DataSource {
  constructor(
    private readonly cloud: DataSource,
    private readonly local: LocalSource,
  ) {}
  ready() { return this.cloud.ready(); }

  /**
   * One retry before giving up on the cloud.
   *
   * Measured against the live tier, identical queries range 0.23s to 4.53s
   * with statistics current and plans sound — that is shared-CPU variance on
   * the free plan, not our SQL. When a query drifts past PostgREST's
   * statement timeout the call fails outright, and without a retry a single
   * unlucky moment silently drops the user onto the 6,000-place bundle while
   * the cloud holds 102,315. Retrying once costs a few hundred ms on the rare
   * failure and converts most of them into a correct answer.
   */
  private async once<T>(run: (ds: DataSource) => Promise<T>): Promise<T> {
    try {
      return await run(this.cloud);
    } catch {
      await new Promise((r) => setTimeout(r, 350));
      return run(this.cloud);
    }
  }

  private async or<T>(run: (ds: DataSource) => Promise<T>, empty?: (v: T) => boolean): Promise<T> {
    try {
      const v = await this.once(run);
      // Treat "errored into nothing" and "network said no" the same way.
      if (empty && empty(v)) return await run(this.local);
      return v;
    } catch {
      return run(this.local);
    }
  }
  search(args: Parameters<DataSource['search']>[0]) {
    return this.or((ds) => ds.search(args), (r) => r.places.length === 0 && !args.q && !args.facets?.length);
  }
  suggest(q: string, lat?: number | null, lng?: number | null) {
    return this.or((ds) => ds.suggest(q, lat, lng));
  }
  getPlace(id: string) {
    return this.or((ds) => ds.getPlace(id), (v) => v == null);
  }
  getGoogleReviews(id: string) {
    return this.or((ds) => ds.getGoogleReviews(id), (v) => v.length === 0);
  }
  similarNearby(id: string, limit?: number) {
    return this.or((ds) => ds.similarNearby(id, limit), (v) => v.length === 0);
  }
  countInRadii(args: Parameters<DataSource['countInRadii']>[0], radii: number[]) {
    return this.or((ds) => ds.countInRadii(args, radii));
  }
}

export function getDataSource(): DataSource {
  if (!instance) {
    instance = hasSupabase && supabase
      ? new ResilientSource(new SupabaseSource(supabase), getLocalSource())
      : getLocalSource();
  }
  return instance;
}

export const isCloudBacked = hasSupabase;

export * from './types';
export * from './search';
