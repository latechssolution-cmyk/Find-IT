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

/** How long a cloud call may take before we serve the bundle instead. Tuned
 *  against the measured spread: healthy queries land in 0.2–1.5s, and the
 *  free tier's worst honest case was 4.5s. */
const CLOUD_TIMEOUT_MS = 6000;
const CLOUD_RETRY_TIMEOUT_MS = 4000;

/** Sentinel so a deadline is distinguishable from a genuine failure. */
const TIMED_OUT = Symbol('cloud-timeout');

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
  /**
   * A cloud call must FAIL, not hang.
   *
   * The fallback below only runs if the cloud promise settles. Measured with
   * the network genuinely severed, it doesn't always: the place screen sat
   * for 9s+ with getPlace neither resolving nor rejecting, so the bundle —
   * which had the place all along — was never consulted. A rejection would
   * have fallen back in milliseconds.
   *
   * This is the normal failure mode here, not an edge case: on a saturated
   * mobile network a request stalls far more often than it cleanly fails,
   * and a stalled request with no deadline is indistinguishable from a
   * hung app. Race every cloud call against a deadline so "slow" always
   * degrades to "offline" rather than to "frozen".
   */
  private withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(TIMED_OUT), ms);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  private async once<T>(run: (ds: DataSource) => Promise<T>): Promise<T> {
    try {
      return await this.withDeadline(run(this.cloud), CLOUD_TIMEOUT_MS);
    } catch (e) {
      // Retry an ERROR, never a TIMEOUT.
      //
      // A fast error is usually transient — the free tier's shared CPU drops
      // the odd query — and a second attempt 350ms later normally succeeds.
      // A timeout means the network is stalled, and retrying a stall just
      // makes the user wait through the whole deadline twice: measured at
      // 12.5s before this distinction, against ~6s after. Nobody watches a
      // skeleton for twelve seconds; they close the app.
      if (e === TIMED_OUT) throw e;
      await new Promise((r) => setTimeout(r, 350));
      return this.withDeadline(run(this.cloud), CLOUD_RETRY_TIMEOUT_MS);
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
