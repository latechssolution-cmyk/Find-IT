/**
 * Safe back navigation.
 *
 * `router.back()` silently does NOTHING when the history stack is empty, and
 * logs "The action 'GO_BACK' was not handled by any navigator". That happens
 * far more often than it looks:
 *
 *   - onboarding ends with router.replace('/location') — replace leaves no
 *     history, so the picker's back button was dead on first run
 *   - any deep link / notification tap / browser refresh lands on a detail
 *     screen with an empty stack
 *   - a screen closing itself after an async action the user has navigated
 *     away from
 *
 * So every dismissal goes through here: pop if we can, otherwise REPLACE with
 * a sensible parent. Replace (not push) so we never grow a stack of Explores.
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';

export function useBack(fallback: Href = '/') {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
