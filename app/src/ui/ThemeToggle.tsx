/**
 * Light / Dark / Auto selector.
 *
 * A three-way segmented control rather than a binary switch: "Auto" has to be
 * reachable, because a user who deliberately follows their phone's schedule
 * shouldn't be forced to pick a side permanently.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, curve, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme, useThemeStore, type ThemeMode } from './useScheme';

const OPTIONS: { mode: ThemeMode; label: string; icon: IconName }[] = [
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  { mode: 'system', label: 'Auto', icon: 'smartphone' },
];

export function ThemeToggle() {
  const sch = useScheme();
  const c = colors(sch);
  const { mode, setMode } = useThemeStore();

  return (
    <View style={[styles.wrap, curve, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
      {OPTIONS.map((o) => {
        const active = mode === o.mode;
        return (
          <Tap
            key={o.mode}
            onPress={() => setMode(o.mode)}
            haptic="selection"
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityLabel={`${o.label} theme`}
            accessibilityState={{ selected: active }}
            style={[
              styles.seg,
              curve,
              active && { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
            ]}
          >
            <Icon name={o.icon} size={14} color={active ? c.accentText : c.textMuted} muted={!active} />
            <Txt variant="caption" muted={!active}>{o.label}</Txt>
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', gap: 3, padding: 3,
    borderRadius: radius.md, borderWidth: 1,
  },
  seg: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent',
  },
});
