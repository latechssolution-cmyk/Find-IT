/**
 * Crash reporting — wired now, armed later.
 *
 * The GO-LIVE list needs Sentry before launch, but the DSN doesn't exist
 * yet. This module is written so that arming it is configuration, not code:
 *
 *   1. `npx expo install @sentry/react-native`
 *   2. put EXPO_PUBLIC_SENTRY_DSN=... in app/.env
 *   3. rebuild
 *
 * Until both exist, every function here is a cheap no-op — the module is
 * loaded lazily and the app carries no dependency on it. The same pattern
 * as speech recognition and the ML-Kit gate: optional capability, guarded
 * require, nothing to crash on where it's absent.
 *
 * Why not console.error patching or a homemade reporter: release-build
 * crashes die before any JS logger runs. Only a native-level SDK sees them,
 * which is why this is the one observability piece that can't be built
 * in-house for free.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let sentry: any | null | undefined;

function load(): any | null {
  if (sentry !== undefined) return sentry;
  if (!DSN) { sentry = null; return null; }
  try {
    sentry = require('@sentry/react-native');
  } catch {
    sentry = null;      // DSN set but package not installed — stay silent
  }
  return sentry;
}

/** Call once from the root layout, before anything can throw. */
export function initCrashReporting(): void {
  const s = load();
  if (!s) return;
  try {
    s.init({
      dsn: DSN,
      // Launch-week posture: every error, no sampling — 5k/month free quota
      // is plenty for a new app, and a sampled-away crash is unfindable.
      sampleRate: 1.0,
      tracesSampleRate: 0,        // perf tracing costs quota; crashes first
      sendDefaultPii: false,      // no user identifiers, matching the privacy policy
    });
  } catch { /* reporting must never be the thing that crashes */ }
}

/** For caught-but-serious errors: cloud tier down, store corruption, etc. */
export function reportError(e: unknown, context?: Record<string, unknown>): void {
  const s = load();
  if (!s) return;
  try {
    s.captureException(e instanceof Error ? e : new Error(String(e)), {
      extra: context,
    });
  } catch { /* same rule */ }
}
