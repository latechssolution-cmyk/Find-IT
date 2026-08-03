/**
 * Where this listing came from and when we last checked it.
 *
 * Scraped data rots — shops here close, move and change numbers constantly —
 * and a listing that looks authoritative while being nine months stale burns
 * trust far faster than one that admits its age. Saying "checked 2 days ago"
 * is also what makes the report button credible: it frames the data as
 * maintained, so telling us it's wrong feels like it will land somewhere.
 *
 * Deliberately quiet: caption weight, muted, one line, bottom of the screen.
 * It is reassurance for the person who goes looking, not a banner.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '../theme';
import type { Place } from '../data';
import { Icon } from './Icon';
import { Txt } from './primitives';
import { useScheme } from './useScheme';

const DAY_MS = 86_400_000;

/** "today" / "3 days ago" / "last month" — vague on purpose past a week. */
export function freshnessLabel(checkedDay?: number | null): string | null {
  if (checkedDay == null) return null;
  const days = Math.floor(Date.now() / DAY_MS) - checkedDay;
  if (days < 0) return 'today';           // clock skew — never say "in -2 days"
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 400) return `${Math.round(days / 30)} months ago`;
  return 'over a year ago';
}

export function Freshness({ place }: { place: Place }) {
  const sch = useScheme();
  const c = colors(sch);
  const when = freshnessLabel(place.checkedDay);

  // Never verified against Google: say so rather than let the layout imply
  // the same standard of freshness as a scraped row.
  const text = when
    ? `Details from Google · checked ${when}`
    : 'From public map data · not yet verified';

  return (
    <View style={styles.row}>
      <Icon name={when ? 'refresh-cw' : 'info'} size={12} color={c.textFaint} muted />
      <Txt variant="caption" faint>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingTop: space.lg,
  },
});
