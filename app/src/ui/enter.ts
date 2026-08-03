/**
 * Entrance animations, safely.
 *
 * Reanimated's layout animations (`entering={FadeIn…}`) set
 * `visibility: hidden` as their initial state and clear it when the animation
 * runs. On React Native Web that animation frequently never fires — after a
 * client-side route change the element is mounted, laid out, and permanently
 * invisible. Measured on this app: 113 hidden blocks on Explore and an
 * onboarding screen showing nothing but its two buttons.
 *
 * Rather than scatter platform checks, every entrance goes through `enter()`,
 * which yields the animation on native and `undefined` on web. Native keeps
 * the stagger and the craft; the web build renders plain and correct.
 *
 * Usage:  <Animated.View entering={enter(FadeIn.duration(200))}>
 */

import { Platform } from 'react-native';

export function enter<T>(animation: T): T | undefined {
  return Platform.OS === 'web' ? undefined : animation;
}
