/**
 * One icon set, one stroke weight, tinted with currentColor.
 *
 * Emoji were used here originally and that's a documented "instantly amateur"
 * tell: emoji render differently per platform and OS version (so the UI is
 * uncontrolled), can't inherit colour or stroke weight, carry inconsistent
 * optical weight and baseline, and read badly to screen readers.
 *
 * Feather is the single family: 1.5–2px stroke, 24px grid, geometrically
 * consistent. Icons also get knocked back slightly against text — an icon at
 * the same contrast as its label reads heavier than the label.
 */

import React from 'react';
import { Feather } from '@expo/vector-icons';

import type { CategoryBucket } from '../data/types';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({
  name, size = 18, color, muted, style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Pair with a label: knocks the icon back so the two read at equal weight. */
  muted?: boolean;
  style?: any;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      style={[muted ? { opacity: 0.75 } : null, style]}
    />
  );
}

/** Category → icon. Kept next to categoryMeta so the two never drift. */
export const categoryIcon: Record<CategoryBucket | 'all', IconName> = {
  all: 'grid',
  food_drink: 'coffee',
  shopping: 'shopping-bag',
  health: 'heart',
  beauty: 'scissors',
  education: 'book-open',
  services: 'tool',
  entertainment: 'film',
  automotive: 'truck',
  finance: 'credit-card',
  lodging: 'home',
  other: 'map-pin',
};
