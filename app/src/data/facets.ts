/**
 * "Good to know" — Google's about/attributes blocks, filtered down to the
 * handful that actually change a decision here.
 *
 * Google emits ~163 distinct facets across our data, most of them noise
 * ("Quick visit", "Casual", "Groups"). Rendering all of them would bury the
 * two or three that matter, so this is an explicit allow-list, ordered by how
 * much each one changes what a person does next:
 *
 *   1. Cash-only — the single most consequential fact in Pakistan. Arriving
 *      at a restaurant with no cash is the failure this app exists to prevent,
 *      so it renders as a WARNING, not a neutral chip.
 *   2. Halal, women-owned, kid-friendly — the things people here actively
 *      filter on and that the competition does not surface at all.
 *   3. Delivery / takeout / dine-in, cards, parking, Wi-Fi — practical.
 *   4. Accessibility — low frequency but decisive for the people it affects,
 *      so it is never truncated away (see `pinned`).
 *
 * Anything not on this list is dropped. A shorter true list beats a long one.
 */

import type { IconName } from '../ui/Icon';

export type FacetTone = 'warn' | 'good' | 'plain';

export interface Facet {
  key: string;
  label: string;
  icon: IconName;
  tone: FacetTone;
  /** Survives truncation — accessibility info must not be hidden behind "more". */
  pinned?: boolean;
}

/**
 * Google's option name -> our facet. Matching is on the option name only
 * (lowercased); the block name it sits under is not stable across categories.
 */
const FACETS: Record<string, Facet> = {
  'cash-only': { key: 'cash', label: 'Cash only', icon: 'alert-circle', tone: 'warn', pinned: true },
  'credit cards': { key: 'cards', label: 'Cards accepted', icon: 'credit-card', tone: 'good' },
  'debit cards': { key: 'cards', label: 'Cards accepted', icon: 'credit-card', tone: 'good' },
  'nfc mobile payments': { key: 'nfc', label: 'Mobile payments', icon: 'smartphone', tone: 'good' },

  'halal food': { key: 'halal', label: 'Halal', icon: 'check-circle', tone: 'good', pinned: true },
  'identifies as women-owned': { key: 'women', label: 'Women-owned', icon: 'award', tone: 'good', pinned: true },
  'good for kids': { key: 'kids', label: 'Good for kids', icon: 'smile', tone: 'plain' },
  'nursing room': { key: 'nursing', label: 'Nursing room', icon: 'heart', tone: 'plain' },
  'family friendly': { key: 'family', label: 'Family friendly', icon: 'users', tone: 'plain' },

  delivery: { key: 'delivery', label: 'Delivery', icon: 'truck', tone: 'plain' },
  takeout: { key: 'takeout', label: 'Takeaway', icon: 'shopping-bag', tone: 'plain' },
  'dine-in': { key: 'dinein', label: 'Dine-in', icon: 'coffee', tone: 'plain' },
  'outdoor seating': { key: 'outdoor', label: 'Outdoor seating', icon: 'sun', tone: 'plain' },
  'late-night food': { key: 'latenight', label: 'Open late', icon: 'moon', tone: 'plain' },
  'in-store pickup': { key: 'pickup', label: 'In-store pickup', icon: 'shopping-bag', tone: 'plain' },

  'wheelchair accessible entrance': {
    key: 'wheelchair', label: 'Wheelchair accessible', icon: 'user-check', tone: 'good', pinned: true,
  },
  'wheelchair accessible parking lot': {
    key: 'wheelchair_parking', label: 'Accessible parking', icon: 'user-check', tone: 'good', pinned: true,
  },
  'wheelchair accessible restroom': {
    key: 'wheelchair_restroom', label: 'Accessible restroom', icon: 'user-check', tone: 'good', pinned: true,
  },

  'free parking lot': { key: 'parking', label: 'Free parking', icon: 'square', tone: 'plain' },
  'free street parking': { key: 'parking', label: 'Free parking', icon: 'square', tone: 'plain' },
  'on-site parking': { key: 'parking_onsite', label: 'On-site parking', icon: 'square', tone: 'plain' },

  'wi-fi': { key: 'wifi', label: 'Wi-Fi', icon: 'wifi', tone: 'plain' },
  'free wi-fi': { key: 'wifi', label: 'Free Wi-Fi', icon: 'wifi', tone: 'plain' },
  atm: { key: 'atm', label: 'ATM', icon: 'credit-card', tone: 'plain' },
  restroom: { key: 'restroom', label: 'Restroom', icon: 'droplet', tone: 'plain' },

  'appointment required': {
    key: 'appt_req', label: 'Appointment required', icon: 'calendar', tone: 'warn', pinned: true,
  },
  'appointments recommended': {
    key: 'appt', label: 'Appointment recommended', icon: 'calendar', tone: 'plain',
  },
  'accepts walk-ins': { key: 'walkin', label: 'Walk-ins welcome', icon: 'user-plus', tone: 'good' },
  'emergency services': { key: 'emergency', label: 'Emergency services', icon: 'alert-circle', tone: 'good', pinned: true },
  'onsite services': { key: 'onsite', label: 'On-site services', icon: 'home', tone: 'plain' },
};

/** Rank within the rendered list. Lower sorts first. */
const ORDER = [
  'cash', 'appt_req', 'emergency', 'halal', 'women', 'cards', 'nfc',
  'delivery', 'takeout', 'dinein', 'pickup', 'kids', 'nursing', 'family',
  'wheelchair', 'wheelchair_parking', 'wheelchair_restroom',
  'parking', 'parking_onsite', 'wifi', 'atm', 'outdoor', 'latenight',
  'walkin', 'appt', 'onsite', 'restroom',
];

/**
 * Query-side intent: "halal biryani near me" means FILTER halal, SEARCH
 * biryani — matching 'halal' against place names would surface places that
 * happen to have it in the name and miss everything else.
 *
 * Only high-precision phrases are extracted. Ambiguous ones ("family",
 * "kids") stay in the text query: "family restaurant" is a kind of place,
 * not a facet demand, and a wrong extraction silently empties results.
 */
const NEED_PHRASES: [string, RegExp][] = [
  ['halal', /\bhalal\b/],
  ['delivery', /\b(home )?delivery\b|\bdelivers?\b/],
  ['cards', /\b(credit |debit |bank )?cards? (accepted|payment)\b|\baccepts? cards?\b/],
  ['parking', /\bparking\b/],
  ['wifi', /\bwi-?fi\b/],
  ['women', /\bwomen[- ]owned\b/],
  ['outdoor', /\boutdoor (seating|dining)\b|\brooftop\b/],
  ['latenight', /\bopen late\b|\blate night\b|\b24.?7\b|\b24 hours?\b/],
];

export function extractNeeds(q: string): { q: string; facets: string[] } {
  let rest = ` ${q.toLowerCase()} `;
  const facets: string[] = [];
  for (const [key, re] of NEED_PHRASES) {
    if (re.test(rest)) {
      facets.push(key);
      rest = rest.replace(re, ' ');
    }
  }
  return { q: rest.replace(/\s+/g, ' ').trim(), facets };
}

interface AboutOption { name?: string; enabled?: boolean }
interface AboutBlock { name?: string; options?: AboutOption[] }

/**
 * Parse the stored attributes JSON into a deduped, ranked facet list.
 * Never throws: attributes come from a scrape and are only ever decoration.
 */
export function parseFacets(attributes?: string | null): Facet[] {
  if (!attributes) return [];

  let blocks: AboutBlock[];
  try {
    const parsed = typeof attributes === 'string' ? JSON.parse(attributes) : attributes;
    if (!Array.isArray(parsed)) return [];
    blocks = parsed as AboutBlock[];
  } catch {
    return [];
  }

  const seen = new Map<string, Facet>();
  for (const blk of blocks) {
    for (const opt of blk?.options ?? []) {
      if (!opt?.enabled || !opt.name) continue;
      const hit = FACETS[opt.name.trim().toLowerCase()];
      // Two Google options can map to one facet ("credit cards" + "debit
      // cards" -> "Cards accepted"); the Map dedupes on our key, not theirs.
      if (hit && !seen.has(hit.key)) seen.set(hit.key, hit);
    }
  }

  // "Cash only" and "Cards accepted" are contradictory and Google does emit
  // both on the same place. Cash-only is the costlier one to get wrong.
  if (seen.has('cash')) { seen.delete('cards'); seen.delete('nfc'); }

  return [...seen.values()].sort(
    (a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99),
  );
}

/**
 * Split for display: what to show collapsed, and what hides behind "+N more".
 * Pinned facets are always visible however long the list is.
 */
export function splitFacets(facets: Facet[], limit = 6): { shown: Facet[]; rest: Facet[] } {
  if (facets.length <= limit) return { shown: facets, rest: [] };
  const pinned = facets.filter((f) => f.pinned);
  const shown = [...pinned, ...facets.filter((f) => !f.pinned)].slice(0, Math.max(limit, pinned.length));
  const keys = new Set(shown.map((f) => f.key));
  return {
    shown: facets.filter((f) => keys.has(f.key)),   // keep original ranking
    rest: facets.filter((f) => !keys.has(f.key)),
  };
}
