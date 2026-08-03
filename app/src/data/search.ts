/**
 * Smart search (PRD §8), implemented so the ON-DEVICE path and the Supabase
 * path rank identically — same normalisation, same synonyms, same formula.
 *
 * Forgiveness pipeline: normalise -> synonym expand -> match (prefix / substring
 * / token / trigram) -> rank by relevance x quality x proximity x open-now.
 */

import type { CategoryBucket, Place, SearchArgs } from './types';

/* ------------------------------------------------------------ normalisation */

const DIACRITICS = /[̀-ͯ]/g;

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')  // keep Urdu block
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pakistani-English / Roman-Urdu variants. This table is the difference
 * between "search works" and "search works HERE" — "saloon" for salon and
 * "hotel" for a roadside restaurant are the local norm, not typos.
 */
export const SYNONYMS: Record<string, string[]> = {
  chai: ['tea', 'chaye', 'chae', 'dhaba', 'cafe'],
  tea: ['chai', 'chaye', 'dhaba'],
  dhaba: ['restaurant', 'chai', 'hotel', 'tea'],
  hotel: ['restaurant', 'dhaba', 'guest house', 'lodging'],
  restaurant: ['food', 'dhaba', 'hotel', 'karahi', 'eatery'],
  karahi: ['restaurant', 'bbq', 'desi', 'food'],
  biryani: ['rice', 'restaurant', 'food', 'pulao'],
  pulao: ['biryani', 'rice', 'restaurant'],
  bbq: ['barbeque', 'barbecue', 'tikka', 'karahi', 'restaurant'],
  tikka: ['bbq', 'barbeque', 'restaurant'],
  nashta: ['breakfast', 'halwa puri', 'restaurant'],
  salon: ['saloon', 'parlour', 'parlor', 'beauty', 'hair'],
  saloon: ['salon', 'parlour', 'beauty', 'barber'],
  parlour: ['salon', 'beauty', 'parlor'],
  barber: ['hair', 'salon', 'saloon', 'hajaam'],
  medical: ['pharmacy', 'medicine', 'chemist', 'store', 'clinic'],
  pharmacy: ['medical', 'chemist', 'medicine', 'store'],
  chemist: ['pharmacy', 'medical', 'medicine'],
  doctor: ['clinic', 'hospital', 'physician', 'dispensary'],
  clinic: ['doctor', 'hospital', 'dispensary', 'medical'],
  hospital: ['clinic', 'doctor', 'medical'],
  dentist: ['dental', 'doctor', 'clinic'],
  gym: ['fitness', 'workout', 'health club'],
  mechanic: ['workshop', 'auto', 'repair', 'car'],
  workshop: ['mechanic', 'auto', 'repair'],
  petrol: ['fuel', 'pump', 'gas', 'filling station', 'cng'],
  atm: ['bank', 'cash machine'],
  bank: ['atm', 'branch'],
  kiryana: ['grocery', 'general store', 'store', 'mart'],
  grocery: ['kiryana', 'general store', 'mart', 'supermarket'],
  mart: ['supermarket', 'grocery', 'store'],
  darzi: ['tailor', 'stitching'],
  tailor: ['darzi', 'stitching', 'boutique'],
  mobile: ['phone', 'cell', 'smartphone'],
  school: ['academy', 'college', 'education'],
  academy: ['school', 'college', 'tuition', 'coaching'],
  hall: ['marquee', 'marriage hall', 'banquet', 'shadi hall'],
  marquee: ['hall', 'marriage hall', 'banquet'],
};

/**
 * Urdu script → the Latin token our index speaks. Business names in the data
 * are overwhelmingly Latin, so an Urdu query matches NOTHING without this —
 * in either tier (the SQL search is trigram/FTS over Latin name_norm too).
 * Translation happens once at the query edge (see urduToLatin), keeping both
 * engines untouched. Common food/anchor vocabulary; grows by observation.
 */
export const URDU_TOKENS: Record<string, string> = {
  'بریانی': 'biryani',
  'کراہی': 'karahi',
  'کڑاہی': 'karahi',
  'چائے': 'chai',
  'ڈھابہ': 'dhaba',
  'ہوٹل': 'hotel',
  'کھانا': 'food',
  'ریستوران': 'restaurant',
  'ریسٹورنٹ': 'restaurant',
  'پلاؤ': 'pulao',
  'تکہ': 'tikka',
  'بار بی کیو': 'bbq',
  'ناشتہ': 'nashta',
  'حلال': 'halal',
  'مٹھائی': 'sweets',
  'بیکری': 'bakery',
  'برگر': 'burger',
  'پیزا': 'pizza',
  'آئس کریم': 'ice cream',
  'جوس': 'juice',
  'دودھ': 'milk',
  'گوشت': 'meat',
  'مرغی': 'chicken',
  'مچھلی': 'fish',
  'سبزی': 'vegetable',
  'پھل': 'fruit',
  'دوائی': 'pharmacy',
  'دوا': 'pharmacy',
  'میڈیکل': 'medical',
  'ڈاکٹر': 'doctor',
  'ہسپتال': 'hospital',
  'کلینک': 'clinic',
  'دندان': 'dentist',
  'سکول': 'school',
  'اسکول': 'school',
  'کالج': 'college',
  'اکیڈمی': 'academy',
  'مسجد': 'mosque',
  'بینک': 'bank',
  'اے ٹی ایم': 'atm',
  'پٹرول': 'petrol',
  'مکینک': 'mechanic',
  'ورکشاپ': 'workshop',
  'درزی': 'tailor',
  'حجام': 'barber',
  'نائی': 'barber',
  'سیلون': 'salon',
  'پارلر': 'parlour',
  'جم': 'gym',
  'کریانہ': 'kiryana',
  'دکان': 'store',
  'بازار': 'bazaar',
  'مارکیٹ': 'market',
  'کپڑے': 'clothing',
  'جوتے': 'shoes',
  'موبائل': 'mobile',
  'فرنیچر': 'furniture',
  'لانڈری': 'laundry',
  'فوٹو': 'photo',
  'پرنٹنگ': 'printing',
  'شادی ہال': 'marriage hall',
  'ہال': 'hall',
};

const HAS_URDU = /[؀-ۿ]/;

/** Translate any known Urdu tokens; unknown Urdu words pass through (they
 *  can still trigram-match a name that carries Urdu). Latin text unchanged. */
export function urduToLatin(q: string): string {
  if (!HAS_URDU.test(q)) return q;
  let out = q;
  // Longest phrases first so 'شادی ہال' wins over bare 'ہال'.
  for (const [ur, en] of Object.entries(URDU_TOKENS)
    .sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(ur).join(en);
  }
  return out.replace(/\s+/g, ' ').trim();
}

const CATEGORY_WORDS: Record<string, CategoryBucket> = {
  restaurant: 'food_drink', food: 'food_drink', cafe: 'food_drink', chai: 'food_drink',
  bakery: 'food_drink', biryani: 'food_drink', bbq: 'food_drink', dhaba: 'food_drink',
  shop: 'shopping', store: 'shopping', mart: 'shopping', clothing: 'shopping',
  grocery: 'shopping', kiryana: 'shopping',
  pharmacy: 'health', clinic: 'health', hospital: 'health', doctor: 'health', dentist: 'health',
  salon: 'beauty', saloon: 'beauty', barber: 'beauty', parlour: 'beauty',
  school: 'education', college: 'education', academy: 'education', university: 'education',
  bank: 'finance', atm: 'finance',
  hotel: 'lodging', guesthouse: 'lodging',
  mechanic: 'automotive', workshop: 'automotive', petrol: 'automotive', car: 'automotive',
  gym: 'entertainment', cinema: 'entertainment', park: 'entertainment',
  tailor: 'services', laundry: 'services', printing: 'services',
};

export function expand(q: string): string[] {
  const base = norm(q);
  if (!base) return [];
  const out = new Set<string>([base]);
  for (const tok of base.split(' ')) {
    out.add(tok);
    for (const syn of SYNONYMS[tok] ?? []) out.add(syn);
  }
  return [...out];
}

/**
 * Query completions — "bir" → "biryani".
 *
 * Distinct from place suggestions, which answer "did you mean THIS shop?".
 * These answer "did you mean this KIND of thing?", and they matter more here
 * than in a Western app: typing Roman-Urdu on a phone keyboard is slow and
 * error-prone, so every character we save is real. Prefix matches first
 * (they're what the user is mid-way through typing), then typo repairs.
 */
const COMPLETION_VOCAB: string[] = Array.from(new Set([
  // what people actually search for, most-wanted first
  'biryani', 'karahi', 'chai', 'nihari', 'haleem', 'pizza', 'burger',
  'ice cream', 'bakery', 'sweets', 'juice', 'breakfast', 'bbq', 'tikka',
  'pharmacy', 'clinic', 'doctor', 'dentist', 'hospital', 'lab',
  'salon', 'barber', 'parlour', 'spa', 'gym',
  'grocery', 'kiryana', 'mart', 'bakery', 'mobile shop', 'clothing',
  'shoes', 'furniture', 'hardware', 'stationery', 'book shop',
  'school', 'academy', 'college', 'tuition', 'library',
  'bank', 'atm', 'petrol pump', 'cng', 'mechanic', 'car wash', 'workshop',
  'tailor', 'darzi', 'laundry', 'printing', 'photocopy', 'photographer',
  'hotel', 'guest house', 'marquee', 'marriage hall', 'park', 'cinema',
  'courier', 'mosque', 'vet', 'nursery', 'optician', 'jeweller',
  ...Object.keys(SYNONYMS),
]));

export function completeTerm(raw: string, limit = 4): string[] {
  const q = norm(urduToLatin(raw));
  if (q.length < 2) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  const typos: string[] = [];
  for (const w of COMPLETION_VOCAB) {
    if (w === q) continue;                       // already typed it exactly
    if (w.startsWith(q)) starts.push(w);
    else if (q.length >= 3 && w.includes(q)) contains.push(w);
    else if (q.length >= 4 && isTypoOf(w, q)) typos.push(w);
  }
  const byLength = (a: string, b: string) => a.length - b.length;
  return [...starts.sort(byLength), ...contains.sort(byLength), ...typos]
    .slice(0, limit);
}

export function guessCategory(q: string): CategoryBucket | null {
  for (const tok of norm(q).split(' ')) {
    const direct = CATEGORY_WORDS[tok];
    if (direct) return direct;
    for (const syn of SYNONYMS[tok] ?? []) {
      if (CATEGORY_WORDS[syn]) return CATEGORY_WORDS[syn];
    }
  }
  return null;
}

/* ----------------------------------------------------------------- matching */

/**
 * Bounded Levenshtein. Trigrams are weak at TRANSPOSITIONS — "birayni" vs
 * "biryani" shares only 4 of 12 trigrams (0.33) and would be rejected, even
 * though it is two edits away. Edit distance catches exactly that class of
 * typo, which is the most common way people misspell transliterated words.
 * Bails out early once the distance exceeds `max` (keeps it cheap in a loop).
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;   // no path can recover
    prev = cur;
  }
  return prev[b.length];
}

/** True when two words are close enough to be the same word mistyped. */
export function isTypoOf(word: string, term: string): boolean {
  const n = Math.min(word.length, term.length);
  if (n < 4) return false;
  const budget = n >= 7 ? 2 : 1;
  return editDistance(word, term, budget) <= budget;
}

/** Trigram similarity — the same measure Postgres pg_trgm uses, so the
 *  on-device path and the server path agree on what counts as a typo. */
export function trigramSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = (s: string) => {
    const p = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = tri(a), B = tri(b);
  let shared = 0;
  A.forEach((t) => { if (B.has(t)) shared++; });
  return shared / (A.size + B.size - shared);
}

/* ------------------------------------------------------------------ ranking */

/**
 * Google's `$`–`$$$$` tiers mean nothing to someone budgeting in rupees, and
 * with Pakistani CPI having peaked near 38% in 2023 a static tier detaches
 * from reality fast. Where Google already gives an explicit rupee range we
 * pass it through; otherwise we translate the tier into a rough per-person
 * band so the number is at least in the right currency.
 */
export function formatPrice(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Already a real range ("Rs 1,000–5,000", "₨500–1,000") — keep it.
  if (/\d/.test(s)) return s.replace(/^PKR\s*/i, 'Rs ').replace(/-/g, '–');
  const tiers: Record<string, string> = {
    '$': 'Under Rs 500',
    '$$': 'Rs 500–1,500',
    '$$$': 'Rs 1,500–4,000',
    '$$$$': 'Rs 4,000+',
  };
  return tiers[s] ?? null;
}

const R = 6371e3;
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const p1 = (aLat * Math.PI) / 180, p2 = (bLat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Bayesian prior: 4.9★ from 3 raters must not outrank 4.6★ from 800. */
export function qualityPrior(rating: number | null, count: number | null): number {
  if (rating == null) return 0.55;
  const n = count ?? 0;
  return (n * rating + 20 * 3.9) / (n + 20) / 5;
}

const DAY_KEYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

/** Parses the compact hours string. null = unknown (never a false "closed"). */
export function isOpenNow(hours: string | null | undefined, now = new Date()): boolean | null {
  if (!hours) return null;
  const key = DAY_KEYS[now.getDay()];
  for (const seg of hours.split('|')) {
    const i = seg.indexOf(':');
    if (i < 0 || seg.slice(0, i) !== key) continue;
    const part = seg.slice(i + 1).trim();
    if (/24\s*hours/i.test(part)) return true;
    if (/closed/i.test(part)) return false;
    const m = part.split(/[–-]/);
    if (m.length < 2) return null;
    const parse = (t: string): number | null => {
      const r = /(\d{1,2})(?::(\d{2}))?\s*([AaPp])?/.exec(t.trim());
      if (!r) return null;
      let h = parseInt(r[1], 10);
      const min = r[2] ? parseInt(r[2], 10) : 0;
      const ap = r[3]?.toLowerCase();
      if (ap === 'p' && h !== 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
      return h * 60 + min;
    };
    const o = parse(m[0]), c = parse(m[1]);
    if (o == null || c == null) return null;
    const t = now.getHours() * 60 + now.getMinutes();
    return c < o ? t >= o || t <= c : t >= o && t <= c;
  }
  return null;
}

export interface Scored { place: Place; score: number; rel: number }

/** The PRD §8 formula, weights identical to search_places() in SQL. */
export function scorePlace(
  p: Place, rel: number, origin: { lat: number; lng: number } | null, radiusM: number,
): Scored {
  const dist = origin ? distanceM(origin.lat, origin.lng, p.lat, p.lng) : null;
  const prox = dist == null ? 0.5 : Math.exp(-(dist / Math.max(radiusM, 1)) * 1.6);
  const open = isOpenNow(p.hours);
  const openScore = open === true ? 1 : open == null ? 0.5 : 0.15;
  const score =
    0.40 * rel +
    0.25 * qualityPrior(p.rating, p.ratingCount) +
    0.20 * prox +
    0.10 * openScore +
    0.05 * Math.min(Math.log1p(p.ratingCount ?? 0) / 7, 1);
  return { place: { ...p, distanceM: dist, score }, score, rel };
}

/** Relevance of one place against an expanded query. 0 = no match. */
export function relevance(p: Place, terms: string[], rawQ: string): number {
  if (!terms.length) return 0.5;
  const name = norm(p.name);
  const hay = `${name} ${norm(p.googleCategory ?? '')} ${norm(p.categoryBucket ?? '')} ${norm(p.locality ?? '')}`;
  const q = norm(rawQ);

  const nameWords = name.split(' ');
  const hayWords = hay.split(' ');

  if (name === q) return 1;
  if (name.startsWith(q)) return 0.95;
  // Full-phrase containment only at word starts: "shan karahi house"
  // matches "karahi", but "designer" must not match "desi".
  if (q.includes(' ') ? name.includes(q) : nameWords.some((w) => w.startsWith(q))) return 0.85;

  // Whole words only for term hits. Substring matching once ranked a
  // "Graphic DESIgner" top for "karahi" (synonym 'desi') — in a 6k-place
  // index there is always SOME name embedding a short synonym. Prefix match
  // stays for longer terms so "biryan" still finds "biryani".
  const wordHit = (words: string[], t: string) =>
    words.some((w) => w === t || (t.length >= 5 && w.startsWith(t)));

  let best = 0;
  for (const t of terms) {
    if (!t) continue;
    if (wordHit(nameWords, t)) best = Math.max(best, 0.8);
    else if (wordHit(hayWords, t)) best = Math.max(best, 0.6);
    else {
      // typo tolerance, per word: trigrams catch insertions/deletions,
      // edit distance catches transpositions ("birayni" -> "biryani").
      for (const w of nameWords) {
        const s = trigramSim(w, t);
        if (s >= 0.45) best = Math.max(best, s * 0.85);
        else if (isTypoOf(w, t)) best = Math.max(best, 0.62);
      }
    }
  }
  return best;
}

export const DEFAULT_RADIUS_M = 5000;
export const RADIUS_STEPS = [1000, 2000, 5000, 10000, 25000];

export function normaliseArgs(a: SearchArgs): Required<Pick<SearchArgs, 'radiusM' | 'limit' | 'offset'>> {
  return {
    radiusM: a.radiusM ?? DEFAULT_RADIUS_M,
    limit: a.limit ?? 40,
    offset: a.offset ?? 0,
  };
}
