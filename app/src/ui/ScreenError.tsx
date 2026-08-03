/**
 * What the user sees if a screen throws.
 *
 * The default is a blank view (production) or a red stack trace (dev) —
 * both are dead ends, and a dead end in a discovery app means the person
 * goes back to Google Maps and doesn't return. This is the same argument as
 * MapBoundary, one level up: a crash should cost the user their current
 * screen, never their session.
 *
 * Deliberately not an apology screen. It offers the two things that actually
 * recover: retry (transient failures — a bad response, a lost socket), and a
 * way back to Explore, which is the only screen with no required params and
 * therefore the one most likely to work.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, curve, radius, space } from '../theme';
import { Icon } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';

export function ScreenError({ error, retry }: { error: Error; retry: () => void }) {
  const sch = useScheme();
  const c = colors(sch);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + space.xxl }]}>
      <View style={[styles.badge, curve, { backgroundColor: c.surfaceAlt }]}>
        <Icon name="alert-triangle" size={22} color={c.textMuted} muted />
      </View>

      <Txt variant="title" style={{ textAlign: 'center' }}>That didn't load</Txt>
      <Txt variant="body" muted style={{ textAlign: 'center' }}>
        Something went wrong on this screen. Your saved places are safe.
      </Txt>

      <View style={styles.actions}>
        <Tap
          onPress={retry}
          haptic="light"
          scaleTo={0.98}
          accessibilityRole="button"
          style={[styles.cta, curve, { backgroundColor: c.brand }]}
        >
          <Icon name="refresh-cw" size={15} color={c.onBrand} />
          <Txt variant="label" color={c.onBrand}>Try again</Txt>
        </Tap>

        <Tap
          onPress={() => router.replace('/')}
          haptic="light"
          scaleTo={0.98}
          accessibilityRole="button"
          style={[styles.cta, curve, { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 }]}
        >
          <Icon name="map" size={15} color={c.textHeading} />
          <Txt variant="label">Back to Explore</Txt>
        </Tap>
      </View>

      {/* The message, small and last: useless to most people, but the one
          thing worth having when someone reports the problem. */}
      {__DEV__ && error?.message ? (
        <Txt variant="caption" faint style={{ textAlign: 'center' }}>{error.message}</Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl },
  badge: {
    width: 56, height: 56, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 14, borderRadius: radius.md,
  },
});
