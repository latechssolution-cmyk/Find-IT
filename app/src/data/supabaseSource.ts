/**
 * Supabase-backed data source. Calls the SQL functions in supabase/search.sql,
 * so ranking lives in ONE place (the database) and the client stays thin.
 *
 * Activated only when EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are set; otherwise
 * the app runs on the bundled city export (see index.ts).
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  DataSource, GoogleReview, Place, SearchArgs, SearchResult, Suggestion,
} from './types';
import { DEFAULT_RADIUS_M, RADIUS_STEPS } from './search';
import { extractNeeds } from './facets';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * A user identity with zero signup friction. Saves/reviews sync via RLS
 * (auth.uid()), so we mint an anonymous user on first need — the account can
 * be linked to a phone/email later without losing anything. If the project
 * has anonymous sign-ins disabled this quietly returns null and the sync
 * queue simply keeps waiting; nothing in the UI depends on it succeeding.
 */
let ensuring: Promise<string | null> | null = null;
export function ensureCloudUser(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  if (!ensuring) {
    ensuring = (async () => {
      try {
        const { data } = await supabase!.auth.getSession();
        if (data.session?.user?.id) return data.session.user.id;
        const { data: anon, error } = await supabase!.auth.signInAnonymously();
        if (error) return null;                  // provider disabled — fine
        return anon.user?.id ?? null;
      } catch {
        return null;
      } finally {
        // allow a later retry if this attempt produced no user
        setTimeout(() => { ensuring = null; }, 60_000);
      }
    })();
  }
  return ensuring;
}

/* search_places() returns snake_case columns; map once, here. */
function fromRow(r: any): Place {
  return {
    id: r.id,
    name: r.name,
    categoryBucket: r.category_bucket ?? null,
    googleCategory: r.google_category ?? null,
    lat: r.lat_out ?? r.lat,
    lng: r.lng_out ?? r.lng,
    address: r.address ?? null,
    locality: r.locality ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    socials: r.socials ?? [],
    rating: r.rating ?? null,
    ratingCount: r.rating_count ?? null,
    fiRating: r.fi_rating ?? null,
    fiRatingCount: r.fi_rating_count ?? 0,
    priceRange: r.price_range ?? null,
    hours: r.hours ?? null,
    cardsOk: !!r.cards_ok,
    photoUrls: r.photo_urls ?? [],
    menuUrl: r.menu_url ?? null,
    orderUrl: r.order_online_url ?? null,
    googlePlaceId: r.google_place_id ?? null,
    state: r.state ?? 'seed_only',
    description: r.description ?? null,
    ratingHistogram: r.rating_histogram ? JSON.stringify(r.rating_histogram) : null,
    attributes: r.attributes ? JSON.stringify(r.attributes) : null,
    distanceM: r.distance_m ?? null,
    score: r.score ?? undefined,
  };
}

export class SupabaseSource implements DataSource {
  constructor(private readonly client: SupabaseClient) {}

  async ready() {}

  async search(args: SearchArgs): Promise<SearchResult> {
    // Same query-intent rule as the local source: "halal biryani" filters
    // halal and searches biryani, relaxing to plain text if that empties.
    const rawQ = (args.q ?? '').trim();
    if (rawQ) {
      const ex = extractNeeds(rawQ);
      if (ex.facets.length) {
        const strict = await this.search({
          ...args, q: ex.q || null, facets: [...(args.facets ?? []), ...ex.facets],
        });
        if (strict.places.length) return strict;
      }
    }

    const { data, error } = await this.client.rpc('search_places', {
      q: rawQ || null,
      lat: args.lat ?? null,
      lng: args.lng ?? null,
      radius_m: args.radiusM ?? DEFAULT_RADIUS_M,
      cats: args.cats ?? null,
      open_only: args.openOnly ?? false,
      min_rating: args.minRating ?? null,
      lim: args.limit ?? 40,
      off: args.offset ?? 0,
      needs: args.facets?.length ? args.facets : null,
    });
    if (error) throw error;
    const places = (data ?? []).map(fromRow);
    const result: SearchResult = { places };

    if (!places.length && args.lat != null && args.lng != null) {
      result.widerRadii = (
        await this.countInRadii(args, RADIUS_STEPS.filter((r) => r > (args.radiusM ?? DEFAULT_RADIUS_M)))
      ).filter((r) => r.count > 0);

      // Same ladder as the local source: relax a multi-word query, then always
      // fall back to good places nearby so the screen is never a dead end.
      const words = (args.q ?? '').toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 1) {
        let best: { term: string; count: number } | null = null;
        for (const w of words) {
          const sub = await this.client.rpc('search_places', {
            q: w, lat: args.lat, lng: args.lng,
            radius_m: args.radiusM ?? DEFAULT_RADIUS_M,
            cats: null, open_only: false, min_rating: null, lim: 200, off: 0,
          });
          const n = (sub.data ?? []).length;
          if (n && (!best || n > best.count)) best = { term: w, count: n };
        }
        result.relaxedTerm = best;
      }

      const near = await this.client.rpc('search_places', {
        q: null, lat: args.lat, lng: args.lng,
        radius_m: args.radiusM ?? DEFAULT_RADIUS_M,
        cats: args.cats ?? null, open_only: false, min_rating: null, lim: 6, off: 0,
      });
      result.fallbackPlaces = (near.data ?? []).map(fromRow);
    }
    return result;
  }

  async suggest(q: string, lat?: number | null, lng?: number | null): Promise<Suggestion[]> {
    const { data, error } = await this.client.rpc('suggest_places', {
      q, lat: lat ?? null, lng: lng ?? null, lim: 8,
    });
    if (error) throw error;
    return ((data ?? []) as any[]).map((r: any): Suggestion => ({
      id: r.id,
      name: r.name,
      categoryBucket: r.category_bucket ?? null,
      locality: r.locality ?? null,
      rating: r.rating ?? null,
      distanceM: r.distance_m ?? null,
      kind: 'place' as const,
    }));
  }

  async getPlace(id: string): Promise<Place | null> {
    // lat/lng are PostgREST computed columns (see search.sql) — the geography
    // point itself isn't selectable as numbers.
    const { data, error } = await this.client
      .from('place')
      .select('*,lat,lng')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }

  async getGoogleReviews(id: string): Promise<GoogleReview[]> {
    const { data, error } = await this.client
      .from('google_review_cache').select('reviews').eq('place_id', id).maybeSingle();
    if (error) throw error;
    return (data?.reviews ?? []) as GoogleReview[];
  }

  async similarNearby(id: string, limit = 10): Promise<Place[]> {
    const { data, error } = await this.client.rpc('similar_nearby', {
      p_id: id, radius_m: 3000, lim: limit,
    });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async countInRadii(args: SearchArgs, radii: number[]): Promise<{ radiusM: number; count: number }[]> {
    const { data, error } = await this.client.rpc('count_in_radii', {
      q: args.q ?? null, lat: args.lat ?? null, lng: args.lng ?? null, radii,
    });
    if (error) throw error;
    return ((data ?? []) as any[]).map((r) => ({ radiusM: r.radius_m as number, count: r.n as number }));
  }
}
