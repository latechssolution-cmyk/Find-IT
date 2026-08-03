/**
 * The map must never be able to blank a screen.
 *
 * MapLibre owns a WebGL context, and WebGL is the one part of this app that
 * can fail for reasons entirely outside our control: the browser/OS caps how
 * many live contexts exist, a context can be lost when the GPU is under
 * pressure or the app is backgrounded, and driver bugs on cheap Android
 * hardware — the bulk of this market — are common. Observed here: navigating
 * Explore → place occasionally threw inside <Map> and, with no boundary, took
 * the WHOLE place screen down to a blank white view. The name, hours, phone
 * and directions button are the reason people opened that screen; losing all
 * of them because a texture failed is indefensible.
 *
 * So the map is treated as a progressive enhancement. If it throws, the rest
 * of the screen survives and the user still gets a tap target that hands off
 * to a real maps app — which is where "Directions" was going anyway.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, curve, radius, space } from '../theme';
import { Icon } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';

interface Props {
  children: React.ReactNode;
  /** Rendered instead of the map when it fails. */
  onOpenExternal?: () => void;
  height?: number;
}

interface State { failed: boolean }

class Boundary extends React.Component<Props & { scheme: 'light' | 'dark' }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    // Deliberately not re-thrown: a dead map is recoverable, a dead screen
    // is not. Logged so it still shows up in dev and in crash reporting.
    console.warn('[map] render failed, showing fallback', err);
  }

  render() {
    if (!this.state.failed) return this.props.children as React.ReactElement;
    // height 0 = "this map is decorative here" (Explore, where the results
    // sheet already carries the answer). Render nothing rather than an error
    // card stranded behind the sheet.
    if (this.props.height === 0) return null;
    const c = colors(this.props.scheme);
    return (
      <Tap
        onPress={this.props.onOpenExternal}
        haptic="light"
        scaleTo={0.99}
        accessibilityRole="button"
        accessibilityLabel="Open in maps"
        style={[
          styles.fallback, curve,
          { height: this.props.height ?? 170, backgroundColor: c.surfaceAlt, borderColor: c.border },
        ]}
      >
        <Icon name="map" size={20} color={c.textFaint} muted />
        <Txt variant="caption" muted>
          {this.props.onOpenExternal ? 'Map unavailable — open in Maps' : 'Map unavailable'}
        </Txt>
      </Tap>
    );
  }
}

export function MapBoundary(props: Props) {
  const scheme = useScheme();
  return <Boundary {...props} scheme={scheme} />;
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center', justifyContent: 'center', gap: space.sm,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
  },
});
