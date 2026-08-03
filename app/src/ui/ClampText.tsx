/**
 * Text that clamps to N lines, fades out at the cut, and reveals on tap.
 *
 * The fade is the affordance: a hard truncation reads as a bug or as the end
 * of the text, while a gradient says "there is more here" before the user has
 * read a word. The control sits directly under the fade, where the eye
 * already is.
 *
 * Measurement note: this compares the HEIGHT of a hidden full-length copy
 * against the clamped one. The obvious API — `onTextLayout`, which reports
 * line counts — is iOS/Android only and never fires on React Native Web, so
 * using it silently disables the affordance in the browser. Height comparison
 * behaves identically on all three platforms.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { enter } from './enter';

import { colors, space } from '../theme';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';

export function ClampText({
  children, lines = 2, style, moreLabel = 'See more', lessLabel = 'Show less',
  /** Surface the text sits on — the fade must dissolve into it exactly. */
  surface,
}: {
  children: string;
  lines?: number;
  style?: StyleProp<TextStyle>;
  moreLabel?: string;
  lessLabel?: string;
  surface?: string;
}) {
  const sch = useScheme();
  const c = colors(sch);
  const bg = surface ?? c.surface;

  const [expanded, setExpanded] = useState(false);
  const [fullH, setFullH] = useState(0);
  const [clampedH, setClampedH] = useState(0);

  const onFull = useCallback((e: any) => {
    const h = e.nativeEvent.layout.height;
    setFullH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const onClamped = useCallback((e: any) => {
    const h = e.nativeEvent.layout.height;
    setClampedH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  // 2px tolerance absorbs sub-pixel rounding differences between the two.
  const overflows = fullH > 0 && clampedH > 0 && fullH > clampedH + 2;

  return (
    <View>
      {/* hidden full-length copy, measured only */}
      <View style={styles.probeWrap} pointerEvents="none" aria-hidden>
        <Txt variant="body" style={style} onLayout={onFull}>{children}</Txt>
      </View>

      <View>
        <Txt
          variant="body"
          muted
          numberOfLines={expanded ? undefined : lines}
          style={style}
          onLayout={onClamped}
        >
          {children}
        </Txt>

        {overflows && !expanded ? (
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', bg]}
            locations={[0, 0.92]}
            style={styles.fade}
          />
        ) : null}
      </View>

      {overflows ? (
        <Animated.View entering={enter(FadeIn.duration(150))}>
          <Tap
            onPress={() => setExpanded((v) => !v)}
            haptic="selection"
            scaleTo={0.97}
            style={styles.btn}
            accessibilityRole="button"
            accessibilityLabel={expanded ? lessLabel : moreLabel}
          >
            <Txt variant="label" color={c.accentText}>
              {expanded ? lessLabel : moreLabel}
            </Txt>
          </Tap>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Out of flow and invisible; we only ever read its height.
  probeWrap: {
    position: 'absolute', left: 0, right: 0, top: 0,
    opacity: 0, zIndex: -1,
  },
  // ~1.5 line-heights: enough to read as a gradient, short enough that it
  // never swallows a whole line of legible text.
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 32 },
  btn: { alignSelf: 'flex-start', paddingVertical: space.xs, marginTop: 2 },
});
