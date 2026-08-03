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
import { useScheme } from './useScheme';

export function formatDistance(m?: number | null): string | null {
  if (m == null) return null;
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
}

function PlaceCardBase({
  place, onPress, index = 0, visited,
}: { place: Place; onPress?: () => void; index?: number; visited?: boolean }) {
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
    place.googleCategory ?? meta.label,
    open === true ? 'open now' : open === false ? 'closed now' : null,
    dist ? `${dist} away` : null,
    price,
    place.menuUrl ? 'has menu' : null,
    place.cardsOk ? 'accepts cards' : null,
    visited ? 'visited' : null,
  ].filter(Boolean).join(', ');

  return (
    <Animated.View entering={enter(FadeIn.delay(Math.min(index, 8) * 26).duration(240))}>
      <Tap
        onPress={onPress}
        haptic="light"
        scaleTo={0.985}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        style={[styles.row, { borderBottomColor: c.border }]}
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
            <Txt variant="title" style={{ opacity: 0.35 }}>{meta.icon}</Txt>
          )}
        </View>

        <View style={styles.body}>
          {/* Sans, not serif, in list rows: the serif is reserved for the
              detail screen so it stays a moment rather than a texture. */}
          <Txt
            variant="heading"
            numberOfLines={1}
            color={visited ? c.textMuted : c.textHeading}
          >
            {place.name}
          </Txt>

          <View style={styles.metaRow}>
            {place.rating != null ? (
              <RatingPill value={place.rating} count={place.ratingCount} />
            ) : (
              <Txt variant="caption" faint>New listing</Txt>
            )}
            <Txt variant="caption" muted numberOfLines={1} style={{ flexShrink: 1 }}>
              {place.googleCategory ?? meta.label}
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
