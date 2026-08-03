/**
 * Intent tracking (PRD §5.7 post-visit trigger, §13 metrics).
 *
 * Tapping Call or Directions is the strongest signal a user actually went —
 * far stronger than a save. Two things hang off it:
 *
 *   1. The review nudge. Next time the app opens, a place the user contacted
 *      gets ONE dismissible "How was it?" card. Never a modal ambush.
 *   2. The north-star metric — Directions + Call taps per DAU is the closest
 *      proxy for real-world value delivered.
 *
 * Stored locally only. This is behavioural data about where someone
 * physically went; it stays on the device unless they sign in and opt in.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from './store';
import { track } from './analytics';

const KEY = 'findit.intents.v1';
const MAX = 40;
/** Long enough that the visit has happened, short enough to still recall it. */
const NUDGE_AFTER_MS = 2 * 60 * 60 * 1000;
const NUDGE_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

export type IntentKind = 'call' | 'directions' | 'menu' | 'website' | 'whatsapp';

export interface Intent {
  placeId: string;
  kind: IntentKind;
  at: number;
  /** Set once the user has answered or dismissed the nudge for this place. */
  resolved?: boolean;
}

interface IntentState {
  intents: Intent[];
  hydrated: boolean;
  hydrate(): Promise<void>;
  record(placeId: string, kind: IntentKind): Promise<void>;
  /** The one place worth asking about right now, if any. */
  pendingNudge(): Intent | null;
  resolve(placeId: string): Promise<void>;
  countByKind(kind: IntentKind): number;
}

async function persist(list: Intent[]) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); }
  catch { /* analytics must never break the app */ }
}

export const useIntentStore = create<IntentState>((set, get) => ({
  intents: [],
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      set({ intents: raw ? JSON.parse(raw) : [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  async record(placeId, kind) {
    // Every intent is also a funnel event — one call site, both sinks.
    track(
      kind === 'call' ? 'place_call'
        : kind === 'whatsapp' ? 'place_whatsapp'
        : kind === 'directions' ? 'place_directions'
        : 'place_view',
      { id: placeId, kind },
    );
    const now = Date.now();
    const rest = get().intents.filter(
      (i) => !(i.placeId === placeId && i.kind === kind),
    );
    const next = [...rest, { placeId, kind, at: now }].slice(-MAX);
    set({ intents: next });
    await persist(next);
  },

  pendingNudge() {
    const now = Date.now();
    // Most recent first: ask about the latest place they contacted.
    const candidates = get().intents
      .filter((i) => !i.resolved
        && (i.kind === 'call' || i.kind === 'directions' || i.kind === 'whatsapp')
        && now - i.at > NUDGE_AFTER_MS
        && now - i.at < NUDGE_EXPIRES_MS)
      .sort((a, b) => b.at - a.at);
    return candidates[0] ?? null;
  },

  async resolve(placeId) {
    const next = get().intents.map(
      (i) => (i.placeId === placeId ? { ...i, resolved: true } : i),
    );
    set({ intents: next });
    await persist(next);
  },

  countByKind(kind) {
    return get().intents.filter((i) => i.kind === kind).length;
  },
}));
