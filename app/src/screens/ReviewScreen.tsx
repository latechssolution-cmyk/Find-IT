/**
 * Write a review (PRD §5.7) — the effort-collapse flow.
 *
 * Stars first, then TAG CHIPS. Tapping three chips is a complete review.
 * That is deliberately the whole product: a free-text box gets a fraction of
 * the submissions, and native reviews are the asset that compounds.
 *
 * Craft notes:
 *  - stars animate individually on selection (spatial spring, may overshoot)
 *    while the label crossfades (effects — never bounces)
 *  - the footer CTA only appears once a rating exists, so the screen has
 *    exactly one obvious next action at every moment
 *  - dismissal goes through useBack: this screen is reachable by deep link,
 *    where router.back() would silently do nothing
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInDown, ZoomIn, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { enter } from '../ui/enter';

import { colors, curve, motion, radius, space } from '../theme';
import { getDataSource, type Place } from '../data';
import { Icon } from '../ui/Icon';
import { Button, Chip, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { tagsFor, useSavedStore } from '../hooks/useSaved';

const STAR_LABEL = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const goBack = useBack(id ? `/place/${id}` : '/');
  const store = useSavedStore();

  const [place, setPlace] = useState<Place | null>(null);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    store.hydrate();
    if (id) getDataSource().getPlace(id).then(setPlace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Editing an existing review should open with it, not blank.
  useEffect(() => {
    if (!id) return;
    const mine = store.getReview(id);
    if (mine && stars === 0) {
      setStars(mine.stars);
      setTags(mine.tags ?? []);
      setBody(mine.body ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, store.hydrated]);

  const toggleTag = useCallback((t: string) => {
    Haptics.selectionAsync();
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }, []);

  const pickStars = useCallback((s: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStars((prev) => {
      // Changing polarity invalidates the chips (a "great value" tag makes no
      // sense on a 1-star), so only clear when the band actually changes.
      const band = (n: number) => (n >= 4 ? 'good' : n === 3 ? 'mixed' : 'bad');
      if (prev && band(prev) !== band(s)) setTags([]);
      return s;
    });
  }, []);

  const submit = useCallback(async () => {
    if (!id || stars === 0) return;
    await store.putReview({ placeId: id, stars, tags, body: body.trim() || undefined });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(true);
    setTimeout(goBack, 1500);
  }, [id, stars, tags, body, store, goBack]);

  if (done) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: c.bg }]}>
        <Animated.View entering={enter(ZoomIn.springify().damping(14))} style={styles.doneWrap}>
          <View style={[styles.doneBadge, curve, { backgroundColor: c.openBg }]}>
            <Icon name="check" size={30} color={c.open} />
          </View>
          <Txt variant="display">Review posted</Txt>
          <Txt variant="body" muted style={{ textAlign: 'center', maxWidth: 280 }}>
            You're helping people in your city find good spots.
          </Txt>
        </Animated.View>
      </View>
    );
  }

  const canPost = stars > 0;

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92} style={styles.headBtn}>
          <Icon name="x" size={19} color={c.textHeading} />
        </Tap>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Txt variant="caption" muted>Review</Txt>
          <Txt variant="label" numberOfLines={1}>{place?.name ?? '…'}</Txt>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xxl, paddingBottom: insets.bottom + 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- 1. stars: giant targets, one haptic per tap ---- */}
        <View style={{ gap: space.md, alignItems: 'center', paddingTop: space.lg }}>
          <Txt variant="display">How was it?</Txt>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <StarButton key={s} index={s} active={s <= stars} onPress={() => pickStars(s)} />
            ))}
          </View>
          <View style={{ height: 22, justifyContent: 'center' }}>
            {stars > 0 ? (
              <Animated.View entering={enter(FadeIn.duration(motion.fade))} key={stars}>
                <Txt variant="bodyMed" color={c.accentText}>{STAR_LABEL[stars]}</Txt>
              </Animated.View>
            ) : (
              <Txt variant="body" faint>Tap a star to start</Txt>
            )}
          </View>
        </View>

        {/* ---- 2. tag chips: three taps = a complete review ---- */}
        {canPost ? (
          <Animated.View entering={enter(FadeInDown.duration(280))} style={{ gap: space.md }}>
            <View style={styles.sectionHead}>
              <Txt variant="overline" muted>WHAT STOOD OUT?</Txt>
              {tags.length ? (
                <Txt variant="caption" color={c.accentText}>{tags.length} selected</Txt>
              ) : (
                <Txt variant="caption" faint>optional</Txt>
              )}
            </View>
            <View style={styles.wrap}>
              {tagsFor(stars).map((t) => (
                <Chip key={t} label={t} active={tags.includes(t)} onPress={() => toggleTag(t)} />
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* ---- 3. optional words ---- */}
        {canPost ? (
          <Animated.View entering={enter(FadeInDown.delay(70).duration(280))} style={{ gap: space.md }}>
            <Txt variant="overline" muted>ANYTHING ELSE?</Txt>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={600}
              placeholder="What should people order?"
              placeholderTextColor={c.textFaint}
              style={[
                styles.input, curve,
                { color: c.text, backgroundColor: c.surface, borderColor: c.border },
              ]}
            />
            {body.length > 0 ? (
              <Txt variant="caption" faint style={{ textAlign: 'right' }}>{body.length}/600</Txt>
            ) : null}
          </Animated.View>
        ) : null}
      </ScrollView>

      {canPost ? (
        <Animated.View
          entering={enter(FadeInDown.duration(260))}
          style={[
            styles.footer,
            { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + space.md },
          ]}
        >
          <Button
            label={tags.length ? `Post · ${stars}★ and ${tags.length} tag${tags.length === 1 ? '' : 's'}` : `Post ${stars}★ review`}
            icon="send"
            onPress={submit}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A star that springs on selection. Scale is spatial, so overshoot is fine. */
function StarButton({ index, active, onPress }: { index: number; active: boolean; onPress: () => void }) {
  const c = colors(useScheme());
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  useEffect(() => {
    if (active) {
      s.value = withSpring(1.18, { damping: 10, stiffness: 320 }, () => {
        s.value = withSpring(1, motion.spatial);
      });
    } else {
      s.value = withSpring(1, motion.spatial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <Tap onPress={onPress} haptic="none" scaleTo={0.88} style={styles.starTap}>
      <Animated.View style={anim}>
        <Icon name="star" size={38} color={active ? c.star : c.border} />
      </Animated.View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  doneWrap: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xl },
  doneBadge: {
    width: 68, height: 68, borderRadius: radius.xxl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  starRow: { flexDirection: 'row', gap: space.xs },
  starTap: { paddingHorizontal: 5, paddingVertical: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    minHeight: 110, borderRadius: radius.md, borderWidth: 1,
    padding: space.lg, fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
});
