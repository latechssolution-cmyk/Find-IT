/**
 * Onboarding (PRD §5.1) — two screens, both skippable.
 *
 * The second screen is a PRE-PERMISSION primer: our own explanation first, the
 * OS dialog only after the user taps the primary button. You get exactly one
 * OS prompt per install; burning it on a cold user is how apps end up with a
 * permanently denied permission. Priming measurably lifts grant rates.
 *
 * Declining is a first-class path: the app works fully on a manually picked
 * location, so "Not now" leads somewhere useful rather than a dead end.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { enter } from '../ui/enter';

import { colors, curve, radius, space } from '../theme';
import { Button, Tap, Txt } from '../ui/primitives';
import { Icon, type IconName } from '../ui/Icon';
import { useScheme } from '../ui/useScheme';
import { useLocationStore } from '../hooks/useLocation';

export const ONBOARDED_KEY = 'findit.onboarded.v1';

export default function OnboardingScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const store = useLocationStore();
  const [step, setStep] = useState(0);

  const finish = async (openPicker: boolean) => {
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    router.replace(openPicker ? '/location' : '/');
  };

  const askOS = async () => {
    const granted = await store.request();
    await finish(!granted);       // denied -> straight to the manual picker
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      {step === 0 ? (
        <Animated.View key="a" entering={enter(FadeIn.duration(400))} exiting={FadeOut} style={styles.pane}>
          <HeroMark icon="compass" />
          <Txt variant="display" style={{ textAlign: 'center' }}>Find the good stuff{'\n'}around you</Txt>
          <Txt variant="body" muted style={{ textAlign: 'center' }}>
            Real ratings, real hours, real reviews — for a hundred thousand places
            across Pakistan.
          </Txt>
        </Animated.View>
      ) : (
        <Animated.View key="b" entering={enter(FadeInDown.duration(400))} style={styles.pane}>
          <HeroMark icon="map-pin" />
          <Txt variant="title" style={{ textAlign: 'center' }}>See what's great nearby</Txt>
          <Txt variant="body" muted style={{ textAlign: 'center' }}>
            We use your location only while you're using the app — never in the
            background, and never for ads.
          </Txt>
          <Txt variant="caption" faint style={{ textAlign: 'center' }}>
            Prefer not to? You can pick any spot on the map instead.
          </Txt>
        </Animated.View>
      )}

      <View style={styles.footer}>
        {step === 0 ? (
          <>
            <Button label="Get started" onPress={() => setStep(1)} />
            <Tap onPress={() => finish(true)} haptic="selection" style={styles.skip}>
              <Txt variant="label" muted>Skip</Txt>
            </Tap>
          </>
        ) : (
          <>
            <Button label="Enable location" icon="map-pin" onPress={askOS} />
            <Tap onPress={() => finish(true)} haptic="selection" style={styles.skip}>
              <Txt variant="label" muted>Not now — pick a spot instead</Txt>
            </Tap>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * The hero mark on the first screen anyone ever sees.
 *
 * This was a 64px emoji (🧭 / 📍), which is the exact tell this codebase
 * documents against in ui/Icon.tsx: emoji are drawn by the OS, so they change
 * per platform and version, ignore our colour and stroke weight, and sit on
 * their own baseline. A tinted disc with a Feather glyph is ours in every
 * pixel and matches the icon language of the other six screens.
 */
function HeroMark({ icon }: { icon: IconName }) {
  const c = colors(useScheme());
  return (
    <View style={[styles.heroMark, curve, { backgroundColor: c.accentWash }]}>
      <Icon name={icon} size={34} color={c.accentText} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.xl },
  pane: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  heroMark: {
    width: 96, height: 96, borderRadius: radius.xxl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  footer: { gap: space.md },
  skip: { alignItems: 'center', paddingVertical: space.md },
});
