/** Shared shapes for the data layer. Mirrors supabase/schema.sql. */

export type CategoryBucket =
  | 'food_drink' | 'shopping' | 'health' | 'beauty' | 'education'
  | 'services' | 'entertainment' | 'automotive' | 'finance' | 'lodging' | 'other';

export type PlaceState = 'seed_only' | 'google_matched' | 'google_only' | 'community_added';

export interface Place {
  id: string;
  name: string;
  categoryBucket: CategoryBucket | null;
  googleCategory: string | null;
  lat: number;
  lng: number;
  address: string | null;
  locality: string | null;
  phone: string | null;
  website: string | null;
  /** Mostly Facebook pages — often a small business's only web presence. */
  socials: string[];
  /** Google-sourced rating — always displayed labelled, never blended (PRD §2.4). */
  rating: number | null;
  ratingCount: number | null;
  /** FIND IT's own rating; becomes the headline at >= 5 reviews. */
  fiRating?: number | null;
  fiRatingCount?: number;
  priceRange: string | null;
  /** Compact "mo:9 AM–10 PM|tu:…" */
  hours: string | null;
  cardsOk: boolean;
  photoUrls: string[];
  menuUrl: string | null;
  orderUrl: string | null;
  googlePlaceId: string | null;
  state: PlaceState;
  description?: string | null;
  /** JSON string: {"1":n,…,"5":n} */
  ratingHistogram?: string | null;
  /**
   * Busy-ness 0–100, as 7 arrays of 24 hours indexed Sun..Sat to match
   * Date.getDay(). Google has this; the local competition does not.
   */
  popularTimes?: number[][] | null;
  /** JSON string: Google's about/attributes blocks */
  attributes?: string | null;
  /**
   * When we last saw this place on Google, as whole days since epoch.
   * Null means we never have — the row is open-data seed only, and the UI has
   * to say so rather than let scraped-looking detail imply verification.
   */
  checkedDay?: number | null;
  /** Populated by search queries only. */
  distanceM?: number | null;
  score?: number;
}

export interface GoogleReview {
  author: string | null;
  rating: number | null;
  text: string;
  when: string | null;
}

export interface SearchArgs {
  q?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number;
  cats?: CategoryBucket[] | null;
  openOnly?: boolean;
  /** Facet keys from data/facets.ts (e.g. 'delivery', 'cards', 'halal'). ALL must match. */
  facets?: string[] | null;
  minRating?: number | null;
  limit?: number;
  offset?: number;
}

export interface Suggestion {
  id: string;
  name: string;
  categoryBucket: CategoryBucket | null;
  locality: string | null;
  rating: number | null;
  distanceM: number | null;
  kind: 'place' | 'category' | 'query';
}

/** What the search returned, plus what to do when it returned nothing. */
export interface SearchResult {
  places: Place[];
  /** Set when the query was auto-corrected ("showing results for …"). */
  correctedFrom?: string | null;
  /** Rescue ladder (PRD §5.4): wider radii that WOULD return results. */
  widerRadii?: { radiusM: number; count: number }[];
  relatedCategories?: CategoryBucket[];
  /** A single term from a multi-word query that DOES match ("sushi omakase"
   *  → "sushi"), so we can offer a narrower query instead of nothing. */
  relaxedTerm?: { term: string; count: number } | null;
  /** Last rung of the ladder: always populated on zero results so the screen
   *  can never be an empty dead end. */
  fallbackPlaces?: Place[];
}

export interface DataSource {
  ready(): Promise<void>;
  search(args: SearchArgs): Promise<SearchResult>;
  suggest(q: string, lat?: number | null, lng?: number | null): Promise<Suggestion[]>;
  getPlace(id: string): Promise<Place | null>;
  getGoogleReviews(id: string): Promise<GoogleReview[]>;
  similarNearby(id: string, limit?: number): Promise<Place[]>;
  countInRadii(args: SearchArgs, radii: number[]): Promise<{ radiusM: number; count: number }[]>;
}
