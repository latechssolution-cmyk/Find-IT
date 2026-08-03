/**
 * Saved places + own reviews (PRD §5.7, §5.8).
 *
 * Writes go to local storage FIRST and sync later — in a market with patchy
 * connectivity, a save that fails because the network blinked is a bug, not an
 * edge case. When Supabase is configured the queue drains to it; until then
 * local IS the store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from './store';
import { supabase, hasSupabase, ensureCloudUser } from '../data/supabaseSource';
import { track } from './analytics';

const SAVED_KEY = 'findit.saved.v1';
const REVIEW_KEY = 'findit.reviews.v1';
const QUEUE_KEY = 'findit.syncqueue.v1';

export interface OwnReview {
  placeId: string;
  stars: number;
  tags: string[];
  body?: string;
  createdAt: string;
  synced?: boolean;
}

interface SavedState {
  saved: Record<string, string>;          // placeId -> savedAt
  reviews: Record<string, OwnReview>;     // placeId -> review
  hydrated: boolean;
  hydrate(): Promise<void>;
  isSaved(id: string): boolean;
  toggleSave(id: string): Promise<boolean>;
  putReview(r: Omit<OwnReview, 'createdAt'>): Promise<void>;
  getReview(id: string): OwnReview | null;
  flush(): Promise<void>;
}

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { /* non-fatal */ }
}

export const useSavedStore = create<SavedState>((set, get) => ({
  saved: {},
  reviews: {},
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    const [saved, reviews] = await Promise.all([
      readJSON<Record<string, string>>(SAVED_KEY, {}),
      readJSON<Record<string, OwnReview>>(REVIEW_KEY, {}),
    ]);
    set({ saved, reviews, hydrated: true });
    get().flush();
  },

  isSaved: (id) => Boolean(get().saved[id]),

  async toggleSave(id) {
    const cur = { ...get().saved };
    const nowSaved = !cur[id];
    if (nowSaved) track('place_save', { id });
    if (nowSaved) cur[id] = new Date().toISOString();
    else delete cur[id];
    set({ saved: cur });
    await writeJSON(SAVED_KEY, cur);
    await enqueue({ kind: 'save', placeId: id, on: nowSaved });
    get().flush();
    return nowSaved;
  },

  async putReview(r) {
    track('review_submit', { id: r.placeId, stars: r.stars });
    const review: OwnReview = { ...r, createdAt: new Date().toISOString(), synced: false };
    const next = { ...get().reviews, [r.placeId]: review };
    set({ reviews: next });
    await writeJSON(REVIEW_KEY, next);
    await enqueue({ kind: 'review', review });
    get().flush();
  },

  getReview: (id) => get().reviews[id] ?? null,

  async flush() {
    if (!hasSupabase || !supabase) return;      // local-only until configured
    const queue = await readJSON<any[]>(QUEUE_KEY, []);
    if (!queue.length) return;
    // Anonymous user on demand: zero-friction identity for RLS. Returns null
    // while the provider is disabled — the queue just waits.
    const uid = await ensureCloudUser();
    if (!uid) return;
    const rest: any[] = [];
    for (const item of queue) {
      try {
        const placeId = item.kind === 'save' ? item.placeId : item.review?.placeId;
        const dbId = await resolvePlaceId(placeId);
        if (!dbId) continue;                     // place not in cloud: drop
        if (item.kind === 'save') {
          if (item.on) {
            await supabase.from('saved_place').upsert({ user_id: uid, place_id: dbId });
          } else {
            await supabase.from('saved_place').delete()
              .eq('user_id', uid).eq('place_id', dbId);
          }
        } else if (item.kind === 'review') {
          const r = item.review as OwnReview;
          // review's PK is a surrogate id — the real uniqueness is
          // (place_id, user_id), so the conflict target must say so or a
          // second edit violates the unique constraint instead of updating.
          await supabase.from('review').upsert(
            { user_id: uid, place_id: dbId, stars: r.stars, tags: r.tags, body: r.body ?? null },
            { onConflict: 'place_id,user_id' },
          );
        }
      } catch {
        rest.push(item);                        // keep for the next attempt
      }
    }
    await writeJSON(QUEUE_KEY, rest);
  },
}));

/**
 * A queued item can carry either kind of place id: the cloud DB uuid (saved
 * while online) or the pipeline ext_id from the bundled data (saved offline —
 * "g_1475…" or the canonical uuid, which is a DIFFERENT uuid from the DB row).
 * Resolve to the DB id; ext_id is unique, so one lookup each way suffices.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function resolvePlaceId(pid?: string): Promise<string | null> {
  if (!pid || !supabase) return null;
  if (UUID_RE.test(pid)) {
    const { data } = await supabase.from('place').select('id').eq('id', pid).maybeSingle();
    if (data?.id) return data.id;
  }
  const { data } = await supabase.from('place').select('id').eq('ext_id', pid).maybeSingle();
  return data?.id ?? null;
}

async function enqueue(item: unknown): Promise<void> {
  const q = await readJSON<unknown[]>(QUEUE_KEY, []);
  q.push(item);
  await writeJSON(QUEUE_KEY, q);
}

/** Tag chips shown when writing a review — polarity follows the star rating,
 *  because "great value" makes no sense on a 1-star (PRD §5.7). */
export const REVIEW_TAGS: Record<'good' | 'mixed' | 'bad', string[]> = {
  good: ['Great food', 'Good value', 'Clean', 'Friendly staff', 'Fast service',
         'Family friendly', 'Good parking', 'Cosy', 'Fresh', 'Worth the trip'],
  mixed: ['Decent', 'Average', 'Bit pricey', 'Slow at peak', 'Hit or miss',
          'Good but crowded', 'OK for a quick stop'],
  bad: ['Overpriced', 'Slow service', 'Not clean', 'Rude staff', 'Wrong order',
        'Too crowded', 'Poor quality', 'Hard to find'],
};

export function tagsFor(stars: number): string[] {
  if (stars >= 4) return REVIEW_TAGS.good;
  if (stars === 3) return REVIEW_TAGS.mixed;
  return REVIEW_TAGS.bad;
}
