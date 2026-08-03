/**
 * On-device data source: the bundled city export, searched in memory.
 *
 * This is not a toy stand-in — it is the offline tier from PRD §5.9. Even once
 * Supabase is live, this is what serves the app on a dead connection, so it
 * implements the full DataSource contract and ranks identically.
 */

import type {
  DataSource, GoogleReview, Place, SearchArgs, SearchResult, Suggestion, CategoryBucket,
} from './types';
import {
  DEFAULT_RADIUS_M, RADIUS_STEPS, distanceM, expand, guessCategory, isTypoOf,
  norm, relevance, scorePlace, trigramSim, urduToLatin, cleanName,
} from './search';
import { extractNeeds, parseFacets } from './facets';

/** Shape of the export written by pipeline/export_app_data.py (keys are short
 *  to keep the bundle small). */
interface RawPlace {
  id: string; n: string; c?: string; gc?: string; lat: number; lng: number;
  a?: string; l?: string; ph?: string; w?: string; soc?: string[]; r?: number; rc?: number;
  pr?: string; h?: string; ck?: boolean; ph_urls?: string[]; menu?: string;
  order?: string; gid?: string; st?: string; hist?: string; attr?: string; d?: string;
  pt?: number[][]; ts?: number;
}
interface Bundle {
  city: string; count: number; places: RawPlace[];
  reviews: Record<string, GoogleReview[]>;
}

/** A city bundle that loads on first use instead of at startup. */
export interface LazyCity {
  name: string;
  center: { lat: number; lng: number };
  load(): Promise<Bundle>;
  /** Mutated in place by LocalSource. */
  state: 'idle' | 'loading' | 'done';
}

/** How close a query origin must be to a lazy city before it hydrates. */
const LAZY_REACH_M = 80_000;

function hydrate(r: RawPlace): Place {
  return {
    id: r.id,
    name: cleanName(r.n),
    categoryBucket: (r.c as CategoryBucket) ?? null,
    googleCategory: r.gc ?? null,
    lat: r.lat,
    lng: r.lng,
    address: r.a ?? null,
    locality: r.l ?? null,
    phone: r.ph ?? null,
    website: r.w ?? null,
    socials: r.soc ?? [],
    rating: r.r ?? null,
    ratingCount: r.rc ?? null,
    priceRange: r.pr ?? null,
    hours: r.h ?? null,
    cardsOk: !!r.ck,
    photoUrls: r.ph_urls ?? [],
    menuUrl: r.menu ?? null,
    orderUrl: r.order ?? null,
    googlePlaceId: r.gid ?? null,
    state: (r.st as Place['state']) ?? 'seed_only',
    description: r.d ?? null,
    ratingHistogram: r.hist ?? null,
    popularTimes: r.pt ?? null,
    attributes: r.attr ?? null,
    checkedDay: r.ts ?? null,
  };
}

export class LocalSource implements DataSource {
  private places: Place[] = [];
  private byId = new Map<string, Place>();
  private reviews: Record<string, GoogleReview[]> = {};
  private loaded = false;
  /** placeId -> facet keys, built lazily — parsing 6k attribute blobs up
   *  front would tax startup for a filter most sessions never touch. */
  private facetCache = new Map<string, Set<string>>();

  private readonly bundles: Bundle[];
  private readonly lazy: LazyCity[];

  /**
   * One eager bundle plus optional lazy cities. Parsing every city's JSON at
   * startup scales the app's cold start with the number of cities we scrape
   * (~35 MB and counting) — so only the home city loads eagerly, and others
   * hydrate the first time a query lands near them.
   */
  constructor(bundle: Bundle | Bundle[], lazy: LazyCity[] = []) {
    this.bundles = Array.isArray(bundle) ? bundle : [bundle];
    this.lazy = lazy;
  }

  private merge(b: Bundle): void {
    for (const raw of b.places) {
      const p = hydrate(raw);
      // City exports can overlap at the fringes (Rawalpindi rows in two
      // sweeps); first bundle wins so ordering stays deterministic.
      if (!this.byId.has(p.id)) {
        this.byId.set(p.id, p);
        this.places.push(p);
      }
    }
    Object.assign(this.reviews, b.reviews ?? {});
  }

  async ready(): Promise<void> {
    if (this.loaded) return;
    for (const b of this.bundles) this.merge(b);
    this.loaded = true;
  }

  /** Hydrate any lazy city whose centre is within reach of the query origin. */
  private async ensureFor(origin: { lat: number; lng: number } | null): Promise<void> {
    if (!origin) return;
    for (const city of this.lazy) {
      if (city.state !== 'idle') continue;
      if (distanceM(origin.lat, origin.lng, city.center.lat, city.center.lng) > LAZY_REACH_M) continue;
      city.state = 'loading';
      try {
        this.merge(await city.load());
        city.state = 'done';
      } catch {
        city.state = 'idle';   // transient (dev-server hiccup) — retry next query
      }
    }
  }

  /** Everything, for id lookups that carry no location (deep links). */
  private async ensureAll(): Promise<void> {
    for (const city of this.lazy) {
      if (city.state !== 'idle') continue;
      city.state = 'loading';
      try {
        this.merge(await city.load());
        city.state = 'done';
      } catch {
        city.state = 'idle';
      }
    }
  }

  private facetKeys(p: Place): Set<string> {
    let keys = this.facetCache.get(p.id);
    if (!keys) {
      keys = new Set(parseFacets(p.attributes).map((f) => f.key));
      this.facetCache.set(p.id, keys);
    }
    return keys;
  }

  async search(args: SearchArgs): Promise<SearchResult> {
    await this.ready();
    const radiusM = args.radiusM ?? DEFAULT_RADIUS_M;
    const origin = args.lat != null && args.lng != null ? { lat: args.lat, lng: args.lng } : null;
    await this.ensureFor(origin);

    // "halal biryani" = filter halal, search biryani. If the facet filter
    // empties an otherwise-matching result set (facet coverage is partial —
    // Google only knows it for some places), retry as plain text: results
    // that ignore the need beat an empty screen.
    const rawQ = urduToLatin((args.q ?? '').trim());
    if (rawQ) {
      const ex = extractNeeds(rawQ);
      if (ex.facets.length) {
        // Recursion is safe: the inner query has the need words stripped, so
        // extractNeeds finds nothing on the second pass.
        const strict = await this.search({
          ...args, q: ex.q || null, facets: [...(args.facets ?? []), ...ex.facets],
        });
        if (strict.places.length) return strict;
        // else fall through and run the original text query untouched
      }
    }
    const terms = expand(rawQ);

    let pool = this.places;
    if (origin) {
      pool = pool.filter((p) => distanceM(origin.lat, origin.lng, p.lat, p.lng) <= radiusM);
    }
    if (args.cats?.length) {
      pool = pool.filter((p) => p.categoryBucket && args.cats!.includes(p.categoryBucket));
    }
    if (args.minRating != null) {
      pool = pool.filter((p) => (p.rating ?? 0) >= args.minRating!);
    }
    if (args.facets?.length) {
      pool = pool.filter((p) => {
        const keys = this.facetKeys(p);
        return args.facets!.every((f) =>
          // cardsOk is a separate scraped boolean with far better coverage
          // than the attributes blocks, so let it satisfy the cards facet.
          f === 'cards' ? (keys.has('cards') || p.cardsOk) : keys.has(f));
      });
    }

    const scored = pool
      .map((p) => scorePlace(p, rawQ ? relevance(p, terms, rawQ) : 0.5, origin, radiusM))
      .filter((s) => (rawQ ? s.rel > 0.28 : true));

    if (args.openOnly) {
      // isOpenNow already folded into score; here it's a hard filter.
      const { isOpenNow } = await import('./search');
      scored.splice(0, scored.length, ...scored.filter((s) => isOpenNow(s.place.hours) !== false));
    }

    scored.sort((a, b) => b.score - a.score);
    const offset = args.offset ?? 0;
    const page = scored.slice(offset, offset + (args.limit ?? 40)).map((s) => s.place);

    const result: SearchResult = { places: page };

    // Did we auto-correct? Surface it ("showing results for …", PRD §5.4).
    if (rawQ && page.length) {
      const top = norm(page[0].name);
      const q = norm(rawQ);
      if (!top.includes(q) && trigramSim(top.split(' ')[0], q) > 0.45) {
        result.correctedFrom = rawQ;
      }
    }

    // Zero-result rescue ladder. Every rung is optional EXCEPT the last:
    // fallbackPlaces is always populated, so the screen is never a dead end.
    if (!page.length) {
      if (origin) {
        result.widerRadii = (await this.countInRadii(args, RADIUS_STEPS.filter((r) => r > radiusM)))
          .filter((r) => r.count > 0);
      }

      // Relax a multi-word query to its best single term ("sushi omakase" →
      // "sushi"): far more useful than telling someone to try again.
      const words = norm(rawQ).split(' ').filter((w) => w.length >= 3);
      if (words.length > 1) {
        let best: { term: string; count: number } | null = null;
        for (const w of words) {
          const sub = await this.search({ ...args, q: w, limit: 200, offset: 0 });
          if (sub.places.length && (!best || sub.places.length > best.count)) {
            best = { term: w, count: sub.places.length };
          }
        }
        result.relaxedTerm = best;
      }

      const guess = guessCategory(rawQ);
      const related = new Set<CategoryBucket>();
      if (guess) related.add(guess);
      for (const p of this.places) {
        if (related.size >= 4) break;
        if (rawQ && p.categoryBucket && relevance(p, terms, rawQ) > 0.5) related.add(p.categoryBucket);
      }
      // Still nothing to suggest? Offer the categories that actually exist
      // around here, ranked by how much there is of each.
      if (related.size === 0 && origin) {
        const counts = new Map<CategoryBucket, number>();
        for (const p of this.places) {
          if (!p.categoryBucket) continue;
          if (distanceM(origin.lat, origin.lng, p.lat, p.lng) > radiusM) continue;
          counts.set(p.categoryBucket, (counts.get(p.categoryBucket) ?? 0) + 1);
        }
        [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .forEach(([cat]) => related.add(cat));
      }
      result.relatedCategories = [...related];

      // Last rung: the best-rated places nearby, whatever they are.
      const near = await this.search({ ...args, q: null, limit: 6, offset: 0 });
      result.fallbackPlaces = near.places;
    }
    return result;
  }

  async suggest(q: string, lat?: number | null, lng?: number | null): Promise<Suggestion[]> {
    await this.ready();
    if (lat != null && lng != null) await this.ensureFor({ lat, lng });
    const nq = norm(urduToLatin(q));
    if (nq.length < 2) return [];
    const origin = lat != null && lng != null ? { lat, lng } : null;

    const hits = this.places
      .map((p) => {
        const n = norm(p.name);
        let s = 0;
        if (n.startsWith(nq)) s = 1;
        else if (n.includes(nq)) s = 0.8;
        else {
          // Suggest must forgive the SAME typos search does — users type here
          // first, and a suggest list that can't handle "birayni" makes the
          // typo tolerance downstream invisible. Match per word, not against
          // the whole name (whole-name trigrams drown a short query).
          for (const w of n.split(' ')) {
            if (w.length < 3) continue;
            if (w.startsWith(nq)) { s = Math.max(s, 0.9); break; }
            const t = trigramSim(w, nq);
            if (t >= 0.45) s = Math.max(s, t * 0.8);
            else if (isTypoOf(w, nq)) s = Math.max(s, 0.55);
          }
        }
        return { p, s };
      })
      .filter((h) => h.s > 0.32)
      .sort((a, b) => b.s - a.s || (b.p.ratingCount ?? 0) - (a.p.ratingCount ?? 0))
      .slice(0, 8);

    return hits.map(({ p }) => ({
      id: p.id,
      name: p.name,
      categoryBucket: p.categoryBucket,
      locality: p.locality,
      rating: p.rating,
      distanceM: origin ? distanceM(origin.lat, origin.lng, p.lat, p.lng) : null,
      kind: 'place' as const,
    }));
  }

  async getPlace(id: string): Promise<Place | null> {
    await this.ready();
    const hit = this.byId.get(id);
    if (hit) return hit;
    // Deep link into a city that hasn't hydrated: load the rest, then retry.
    await this.ensureAll();
    return this.byId.get(id) ?? null;
  }

  async getGoogleReviews(id: string): Promise<GoogleReview[]> {
    await this.ready();
    if (!this.reviews[id] && !this.byId.has(id)) await this.ensureAll();
    return this.reviews[id] ?? [];
  }

  async similarNearby(id: string, limit = 10): Promise<Place[]> {
    await this.ready();
    const p = this.byId.get(id);
    if (!p) return [];
    return this.places
      .filter((o) => o.id !== p.id && o.categoryBucket === p.categoryBucket)
      .map((o) => ({ o, d: distanceM(p.lat, p.lng, o.lat, o.lng) }))
      .filter((x) => x.d <= 3000)
      .sort((a, b) =>
        (b.o.rating ?? 0) * Math.log1p(b.o.ratingCount ?? 0) -
        (a.o.rating ?? 0) * Math.log1p(a.o.ratingCount ?? 0) || a.d - b.d)
      .slice(0, limit)
      .map((x) => ({ ...x.o, distanceM: x.d }));
  }

  async countInRadii(args: SearchArgs, radii: number[]) {
    await this.ready();
    if (args.lat != null && args.lng != null) await this.ensureFor({ lat: args.lat, lng: args.lng });
    const out: { radiusM: number; count: number }[] = [];
    for (const radiusM of radii) {
      const r = await this.search({ ...args, radiusM, limit: 1000, offset: 0 });
      out.push({ radiusM, count: r.places.length });
    }
    return out;
  }

  /**
   * "200 m from Lyallpur Galleria" — a landmark description of where a place is.
   *
   * Pakistani addresses are landmark-dependent in practice, and the scraped
   * `address` field is often unusable for actually finding a shop. Google built
   * Address Descriptors for exactly this problem — but shipped it GA in India
   * and left Pakistan out, so this is a gap we can fill from data we hold.
   *
   * A landmark is close, far better known than the target (rating count being
   * the best available proxy for "everyone knows it"), and not the target.
   */
  /**
   * "400 m from Jinnah Colony" — worth more than a postal address here.
   *
   * Takes COORDINATES, not an id. It used to look the subject up by id in the
   * bundle, which meant a cloud-backed place (a DB uuid that isn't in the
   * 6,000-place slice) failed the very first lookup and silently never showed
   * a landmark — i.e. almost never, now that the cloud is the default source.
   * Coordinates work for any place from any source.
   *
   * The bundle stays the LANDMARK source on purpose: it is the top-quality
   * slice of the city, which is exactly the set of places famous enough to
   * navigate by. ensureFor() pulls in the right city first.
   */
  async nearestLandmark(
    lat: number, lng: number, ratingCount?: number | null, selfId?: string,
  ): Promise<{ name: string; distanceM: number } | null> {
    await this.ready();
    await this.ensureFor({ lat, lng });
    const MIN_FAME = 150;
    const MAX_M = 700;
    const mine = ratingCount ?? 0;
    let best: { name: string; distanceM: number } | null = null;
    for (const o of this.places) {
      if (selfId && o.id === selfId) continue;
      if ((o.ratingCount ?? 0) < MIN_FAME) continue;
      // A landmark must be markedly better known than the place itself,
      // otherwise "next to <equally obscure shop>" helps nobody.
      if ((o.ratingCount ?? 0) < mine * 2) continue;
      const d = distanceM(lat, lng, o.lat, o.lng);
      if (d > MAX_M) continue;
      if (!best || d < best.distanceM) best = { name: o.name, distanceM: d };
    }
    return best;
  }

  /** Cheap count for the radius picker's live "N places within X km". */
  async countWithin(lat: number, lng: number, radiusM: number, cats?: CategoryBucket[]): Promise<number> {
    await this.ready();
    await this.ensureFor({ lat, lng });
    let n = 0;
    for (const p of this.places) {
      if (cats?.length && (!p.categoryBucket || !cats.includes(p.categoryBucket))) continue;
      if (distanceM(lat, lng, p.lat, p.lng) <= radiusM) n++;
    }
    return n;
  }
}
