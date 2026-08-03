/**
 * "How was it?" — the post-visit review prompt (PRD §5.7).
 *
 * Deliberately ONE card, inline, dismissible. Not a modal, not a toast that
 * steals focus, and never more than one at a time: the user tapped Call or
 * Directions hours ago, they did not ask to be interrupted now. Dismissing
 * resolves it permanently so the same place can never nag twice.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOutUp } from 'react-native-reanimated';
import { enter } from './enter';

import { colors, curve, radius, shadow, space } from '../theme';
import { getDataSource, type Place } from '../data';
import { Icon } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';
import { useIntentStore } from '../hooks/useIntents';
import { useSavedStore } from '../hooks/useSaved';

export function ReviewNudge() {
  const sch = useScheme();
  const c = colors(sch);
  const router = useRouter();
  const intents = useIntentStore();
  const saved = useSavedStore();
  const [place, setPlace] = useState<Place | null>(null);

  useEffect(() => { intents.hydrate(); saved.hydrate(); }, []);

  const pending = intents.hydrated ? intents.pendingNudge() : null;

  useEffect(() => {
    if (!pending) { setPlace(null); return; }
    // Already reviewed? Then there is nothing to ask.
    if (saved.getReview(pending.placeId)) {
      intents.resolve(pending.placeId);
      return;
    }
    getDataSource().getPlace(pending.placeId).then(setPlace);
  }, [pending?.placeId, saved.hydrated]);

  if (!pending || !place) return null;

  return (
    <Animated.View entering={enter(FadeIn.duration(260))} exiting={FadeOutUp.duration(180)}>
      <View style={[styles.card, curve, { backgroundColor: c.accentWash, borderColor: c.border }, shadow(sch, 1)]}>
        <View style={styles.row}>
          <View style={[styles.badge, curve, { backgroundColor: c.surface }]}>
            <Icon name="message-circle" size={16} color={c.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="label" numberOfLines={1}>How was {place.name}?</Txt>
            <Txt variant="caption" muted>Takes about 30 seconds</Txt>
          </View>
          <Tap
            onPress={() => intents.resolve(place.id)}
            haptic="selection"
            scaleTo={0.9}
            style={styles.dismiss}
            accessibilityLabel="Dismiss"
          >
            <Icon name="x" size={16} color={c.textMuted} muted />
          </Tap>
        </View>
        <Tap
          onPress={() => {
            intents.resolve(place.id);
            router.push({ pathname: '/review/[id]', params: { id: place.id } });
          }}
          haptic="light"
          scaleTo={0.97}
          style={[styles.cta, curve, { backgroundColor: c.brand }]}
        >
          <Txt variant="label" color={c.onBrand}>Rate it</Txt>
        </Tap>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg, marginBottom: space.md,
    padding: space.md, borderRadius: radius.lg, borderWidth: 1, gap: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  dismiss: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  cta: { paddingVertical: 11, borderRadius: radius.md, alignItems: 'center' },
});
