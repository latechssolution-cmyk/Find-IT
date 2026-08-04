/**
 * Natural-language search, client half.
 *
 * Calls the `ask` Edge Function, which holds the model key and does the
 * retrieval server-side. Three things this deliberately does NOT do:
 *
 *  - hold an API key. One shipped in an APK is extracted the day someone
 *    cares, and the bill is ours.
 *  - send place data anywhere. The function reads the question and writes a
 *    sentence; the database stays on the server.
 *  - become a dependency. If the function is missing, unconfigured, slow or
 *    broken, `ask()` returns null and the caller runs the ordinary search —
 *    which already forgives typos, expands synonyms and speaks Urdu. The AI
 *    layer is an upgrade to search, never a gate in front of it.
 */

import { getDataSource } from './index';
import { supabase, hasSupabase } from './supabaseSource';
import type { Place, SearchArgs } from './types';

/** Beyond this the ordinary search would have answered long ago. */
const ASK_TIMEOUT_MS = 12_000;

export interface AskResult {
  /** One line over the results. Null when the model had nothing useful. */
  answer: string | null;
  /** What the question was understood to mean — shown so it can be corrected. */
  intent: {
    q: string | null;
    cats: string[] | null;
    facets: string[] | null;
    openOnly: boolean;
    minRating: number | null;
    radiusM: number;
    priceHint: 'cheap' | 'mid' | 'high' | null;
  } | null;
  /** True when the model was unreachable and filters came from plain rules. */
  degraded: boolean;
  places: Place[];
}

/** Row shape from search_places(), mapped here rather than in the function
 *  so the wire payload stays as small as the RPC makes it. */
function fromRow(r: Record<string, any>): Place {
  return {
    id: r.id,
    name: r.name ?? '',
    categoryBucket: r.category_bucket ?? null,
    googleCategory: r.google_category ?? null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    distanceM: r.distance_m != null ? Number(r.distance_m) : null,
    rating: r.rating != null ? Number(r.rating) : null,
    ratingCount: r.rating_count ?? null,
    priceRange: r.price_range ?? null,
    hours: r.hours ?? null,
    photoUrls: r.photo_urls ?? [],
    cardsOk: !!r.cards_ok,
    menuUrl: r.menu_url ?? null,
    address: r.address ?? null,
    locality: r.locality ?? null,
    phone: r.phone ?? null,
    website: r.website ?? null,
    state: r.state ?? 'seed_only',
  } as Place;
}

export function askAvailable(): boolean {
  return hasSupabase && !!supabase;
}

export async function ask(
  question: string,
  args: Pick<SearchArgs, 'lat' | 'lng'>,
  limit = 12,
): Promise<AskResult | null> {
  if (!askAvailable() || !args.lat || !args.lng) return null;

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS);
    const { data, error } = await supabase!.functions.invoke('ask', {
      body: { question, lat: args.lat, lng: args.lng, limit },
    });
    clearTimeout(t);
    if (error || !data || (data as any).error) return null;

    const d = data as any;
    return {
      answer: typeof d.answer === 'string' ? d.answer : null,
      intent: d.intent ?? null,
      degraded: !!d.degraded,
      places: Array.isArray(d.places) ? d.places.map(fromRow) : [],
    };
  } catch {
    return null;
  }
}

/**
 * What the caller actually wants: an answer, however it arrives.
 *
 * Tries the AI path, and on any failure runs the ordinary search with the
 * raw question. The user gets results either way; only the sentence at the
 * top is contingent.
 */
export async function askOrSearch(
  question: string,
  args: SearchArgs,
): Promise<AskResult> {
  const viaAi = await ask(question, args, args.limit ?? 12);
  if (viaAi && viaAi.places.length) return viaAi;

  const res = await getDataSource().search({ ...args, q: question });
  return { answer: null, intent: null, degraded: true, places: res.places };
}
