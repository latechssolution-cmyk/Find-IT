/**
 * Result card.
 *
 * Two things carry the craft here:
 *  - Paint order: name, rating and distance render immediately; the photo
 *    arrives whenever it arrives. On a bad connection the list is still fully
 *    useful with zero images loaded.
 *  - Framed photography: user-supplied storefront photos arrive at every
 *    possible white balance and WILL clash with a warm ground. A rounded
 *    container with a hairline makes an arbitrary photo read as intentional;
 *    a hard-edged photo bleeding into cream reads as a rendering bug.
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';
import { enter } from './enter';

import { colors, radius, space, categoryMeta, type as typo } from '../theme';
import { formatPrice, isOpenNow, type Place } from '../data';
import { OpenState, RatingPill, Tap, Txt } from './primitives';
import { Icon, categoryIcon } from './Icon';
import { useScheme } from './useScheme';

/**
 * What kind of place this is, in prose.
 *
 * Google's own category when we have one. Otherwise the bucket's label —
 * except for the catch-all bucket, whose label is "More". That reads fine on
 * a filter chip ("More" categories) and badly anywhere it describes a single
 * business, where it looks like a truncation or a link. Unenriched places
 * are exactly the ones with no Google category, so they landed on it most.
 */
export function categoryLabel(place: Pick<Place, 'googleCategory' | 'categoryBucket'>): string {
  if (place.googleCategory) return place.googleCategory;
  const bucket = place.categoryBucket;
  if (!bucket || bucket === 'other') return 'Local business';
  return categoryMeta[bucket]?.label ?? 'Local business';
}

export function formatDistance(m?: number | null): string | null {
  if (m == null) return null;
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
}

/**
 * "~8 min bike" — the answer people are actually computing from "2.9 km".
 *
 * Bikes are the dominant private transport in this market and they cut
 * through congestion cars can't, so kilometres systematically overstate the
 * trip. 18 km/h effective (city traffic, signals included) is deliberately
 * conservative — an estimate that's occasionally pessimistic is trusted,
 * one that's ever optimistic is a lie the user is standing in traffic
 * remembering. Range-capped: under 400 m you'd walk, past 15 km a straight-
 * line estimate stops being honest (real routes diverge too much).
 */
const BIKE_KMH = 18;
export function bikeMinutes(m?: number | null): string | null {
  if (m == null || m < 400 || m > 15_000) return null;
  const mins = Math.ceil((m / 1000 / BIKE_KMH) * 60);
  return `~${mins} min bike`;
}

function PlaceCardBase({
  place, onPress, index = 0, selected,
}: {
  place: Place;
  onPress?: () => void;
  index?: number;
  /** This row's pin is the one currently picked on the map. */
  selected?: boolean;
}) {
  const sch = useScheme();
  const c = colors(sch);
  const meta = categoryMeta[place.categoryBucket ?? 'other'] ?? categoryMeta.other;
  const photo = place.photoUrls?.[0];
  const open = isOpenNow(place.hours);
  const dist = formatDistance(place.distanceM);
  const price = formatPrice(place.priceRange);
  // Google's busy-ness for this hour — the one line no local competitor has.
  // Only whispered when clearly busy AND the place is open; a "quiet" claim
  // is unfalsifiable to the user and reads as filler.
  const now = new Date();
  const busyNow = open === true
    && (place.popularTimes?.[now.getDay()]?.[now.getHours()] ?? 0) >= 70;

  /**
   * One sentence, in decision order — the same order the eye reads the card.
   * Without this a screen reader emits the visual fragments one by one
   * ("4.9", "189", "Open", "190 m"), which is technically complete and
   * practically useless. The children are hidden behind it so the card is a
   * single swipe stop rather than seven.
   */
  const spoken = [
    place.name,
    place.rating != null
      ? `${place.rating.toFixed(1)} out of 5${place.ratingCount ? ` from ${place.ratingCount} ratings` : ''}`
      : 'no ratings yet',
    categoryLabel(place),
    open === true ? 'open now' : open === false ? 'closed now' : null,
    dist ? `${dist} away` : null,
    price,
    place.menuUrl ? 'has menu' : null,
    place.cardsOk ? 'accepts cards' : null,
    selected ? 'selected on map' : null,
  ].filter(Boolean).join(', ');

  return (
    <Animated.View entering={enter(FadeIn.delay(Math.min(index, 8) * 26).duration(240))}>
      <Tap
        onPress={onPress}
        haptic="light"
        scaleTo={0.985}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: !!selected }}
        /* Tapping a map pin scrolls this row into view — it has to be
           obvious WHICH row answered. A tinted ground does that without
           moving anything, so the list doesn't reflow under the finger. */
        style={[
          styles.row,
          { borderBottomColor: c.border },
          selected ? { backgroundColor: c.accentWash } : null,
        ]}
      >
        <View style={[styles.thumb, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          {photo ? (
            /* Scraped Google photo URLs are signed (gps-cs-s) — the size
               directive cannot be rewritten, so we serve what we got. */
            <Image
              source={{ uri: photo }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              cachePolicy="disk"
              recyclingKey={place.id}
            />
          ) : (
            /* Feather, not the emoji in categoryMeta: this app's own
               Icon.tsx calls emoji-as-icons an "instantly amateur" tell —
               they render differently per OS, ignore our colour and stroke
               weight, and sit on their own baseline. */
            <Icon
              name={categoryIcon[place.categoryBucket ?? 'other']}
              size={22}
              color={meta.tint}
              muted
            />
          )}
        </View>

        <View style={styles.body}>
          {/* Sans, not serif, in list rows: the serif is reserved for the
              detail screen so it stays a moment rather than a texture. */}
          <Txt variant="heading" numberOfLines={1} color={c.textHeading}>
            {place.name}
          </Txt>

          <View style={styles.metaRow}>
            {place.rating != null ? (
              <RatingPill value={place.rating} count={place.ratingCount} />
            ) : (
              <Txt variant="caption" faint>New listing</Txt>
            )}
            <Txt variant="caption" muted numberOfLines={1} style={{ flexShrink: 1 }}>
              {categoryLabel(place)}
            </Txt>
          </View>

          <View style={styles.metaRow}>
            <OpenState open={open} compact />
            {busyNow ? <Dot c={c.textFaint} /> : null}
            {busyNow ? <Txt variant="caption" color={c.accentText}>Busy now</Txt> : null}
            {dist ? <Dot c={c.textFaint} /> : null}
            {dist ? <Txt variant="caption" muted>{dist}</Txt> : null}
            {price ? <Dot c={c.textFaint} /> : null}
            {price ? <Txt variant="caption" muted numberOfLines={1}>{price}</Txt> : null}
          </View>

          {(place.cardsOk || place.menuUrl) ? (
            <View style={styles.tagRow}>
              {place.menuUrl ? <MiniTag label="Menu" c={c} /> : null}
              {place.cardsOk ? <MiniTag label="Cards" c={c} /> : null}
            </View>
          ) : null}
        </View>
      </Tap>
    </Animated.View>
  );
}

function Dot({ c }: { c: string }) {
  return <View style={{ width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: c, opacity: 0.7 }} />;
}

function MiniTag({ label, c }: { label: string; c: ReturnType<typeof colors> }) {
  return (
    <View style={[styles.miniTag, { backgroundColor: c.surfaceAlt }]}>
      <Txt variant="caption" muted>{label}</Txt>
    </View>
  );
}

export const PlaceCard = memo(PlaceCardBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: 14,
    paddingHorizontal: space.lg, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 92, height: 92, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 5, justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tagRow: { flexDirection: 'row', gap: 5, marginTop: 1 },
  miniTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.xs },
});
