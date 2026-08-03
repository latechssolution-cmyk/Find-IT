/**
 * Product analytics — local-first, no SDK, no key.
 *
 * The gap this fills: we ship decisions ("call-first categories", facet
 * ranking, rescue-ladder rungs) that are guesses until something measures
 * them. PostHog's free tier is the eventual sink, but there is no reason to
 * block instrumentation on an account: events queue on-device (FIFO, capped)
 * and flush wholesale once a key exists.
 *
 * Deliberate properties:
 *  - fire-and-forget: track() never throws, never awaits in callers
 *  - no PII: place ids and coarse buckets only, never coordinates or queries
 *    beyond their length (a typed query IS user content — we keep result
 *    counts, not text)
 *  - capped queue: analytics must never be the thing that fills a phone
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'findit.events.v1';
const CAP = 500;

export type EventName =
  | 'place_view' | 'place_call' | 'place_whatsapp' | 'place_directions'
  | 'place_share' | 'place_report' | 'place_save'
  | 'search_run' | 'search_zero' | 'filter_use' | 'city_hop'
  | 'review_start' | 'review_submit';

interface Ev {
  n: EventName;
  /** Small scalar props only — see PII note above. */
  p?: Record<string, string | number | boolean>;
  at: number;
}

let queue: Ev[] = [];
let hydrated = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;   // set first: a failed read should not retry per-event
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) queue = [...JSON.parse(raw), ...queue].slice(-CAP);
  } catch { /* start fresh */ }
}

/** Batched persist — one write per burst, not one per tap. */
function persistSoon(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(queue)).catch(() => { /* non-fatal */ });
  }, 800);
}

export function track(n: EventName, p?: Ev['p']): void {
  hydrate().then(() => {
    queue.push({ n, p, at: Date.now() });
    if (queue.length > CAP) queue = queue.slice(-CAP);
    persistSoon();
  }).catch(() => { /* analytics never surfaces an error */ });
}

/** Wired to PostHog /batch once a project key exists. Until then: a no-op
 *  that reports queue depth so a debug screen can show it's alive. */
export async function flush(): Promise<{ pending: number }> {
  await hydrate();
  return { pending: queue.length };
}
