/**
 * Place detail (PRD §5.6) — anatomy in conversion order:
 *   hero → identity → open-now → sticky actions → reviews → map → info → similar
 *
 * Reviews are TWO clearly-labelled shelves (PRD §2.4): FIND IT's own and
 * Google's. The two ratings are never blended into one number.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  FadeIn, FadeInDown, FadeOut, useAnimatedScrollHandler, useAnimatedStyle,
  useSharedValue, withTiming,
} from 'react-native-reanimated';
import { enter } from '../ui/enter';

import { LinearGradient } from 'expo-linear-gradient';

import {
  colors, cream, curve, photoScrim, radius, shadow, space, categoryMeta,
} from '../theme';
import {
  formatPrice, getDataSource, getLocalSource, isOpenNow,
  type GoogleReview, type Place,
} from '../data';
import { parseFacets, splitFacets } from '../data/facets';
import { Map } from '../ui/Map';
import { MapBoundary } from '../ui/MapBoundary';
import { PlaceCard, categoryLabel, formatDistance } from '../ui/PlaceCard';
import { ClampText } from '../ui/ClampText';
import { PopularTimes } from '../ui/PopularTimes';
import { Freshness, freshnessLabel } from '../ui/Freshness';
import { sharePlace } from '../ui/share';
import { Icon, categoryIcon, type IconName } from '../ui/Icon';
import { Button, Card, Chip, EmptyState, RatingPill, Skeleton, Stars, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { useSavedStore } from '../hooks/useSaved';
import { useIntentStore } from '../hooks/useIntents';
import { useReportStore } from '../hooks/useReports';
import { isRamadan } from '../hooks/useRamadan';
import { track } from '../hooks/analytics';
import { ReportSheet } from '../ui/ReportSheet';

/** Sliver of the next photo left visible — the swipe affordance. */
const PHOTO_PEEK = 34;

/** How long a skeleton may claim something is coming before it must explain
 *  itself. Long enough for a slow 3G round trip plus the retry. */
const LOAD_GRACE_MS = 9000;

/** Today, so the week view can emphasise the row that matters. */
const TODAY_KEY = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'][new Date().getDay()];

/**
 * Categories where people make contact before turning up — appointments,
 * quotes, stock checks. For these, contact leads; everywhere else Directions.
 */
const CALL_FIRST_BUCKETS = new Set(['health', 'services', 'automotive', 'beauty', 'lodging']);

/**
 * A Pakistani mobile number is, in practice, a WhatsApp number — and for
 * salons, tailors, clinics, tuition centres and repair shops WhatsApp is how
 * bookings actually happen. It's also markedly lower friction than phoning a
 * stranger, which matters especially for women users. Google has no answer
 * here and structurally won't build one, so this is a real wedge.
 *
 * Mobile prefixes are 03xx locally / 923xx international; landlines are not
 * on WhatsApp, so only offer it for mobiles.
 */
function whatsappNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^\d]/g, '');
  if (/^923\d{9}$/.test(d)) return d;            // 923xx xxxxxxx
  if (/^03\d{9}$/.test(d)) return `92${d.slice(1)}`;  // 03xx xxxxxxx
  return null;
}

/** Opens in Urdu-friendly Roman Urdu — how people actually message a shop. */
const WA_GREETING = 'Assalam o alaikum! FIND IT par aapki jagah dekhi. Kya abhi khuli hai?';

const DAY_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const DAY_NAME: Record<string, string> = {
  mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday',
  fr: 'Friday', sa: 'Saturday', su: 'Sunday',
};

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useBack('/');
  const { width } = useWindowDimensions();

  const [place, setPlace] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<GoogleReview[]>([]);
  const [similar, setSimilar] = useState<Place[]>([]);
  const [tab, setTab] = useState<'findit' | 'google'>('google');
  const [showHours, setShowHours] = useState(false);
  // Everything below starts COLLAPSED: the screen should answer "is this the
  // place?" before it offers to answer anything else.
  const [showAllAttrs, setShowAllAttrs] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(1);

  // Scroll lives on the UI thread, never in React state.
  const scrollY = useSharedValue(0);
  const actionsY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const stickyStyle = useAnimatedStyle(() => {
    const start = actionsY.value + 40;
    const show = actionsY.value > 0 && scrollY.value > start;
    return {
      opacity: withTiming(show ? 1 : 0, { duration: 180 }),
      transform: [{ translateY: withTiming(show ? 0 : 90, { duration: 200 }) }],
    };
  });
  const savedStore = useSavedStore();
  const intents = useIntentStore();
  const saved = id ? savedStore.isSaved(id) : false;
  const myReview = id ? savedStore.getReview(id) : null;
  const [callFallback, setCallFallback] = useState<string | null>(null);
  const [landmark, setLandmark] = useState<{ name: string; distanceM: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Skeletons are a promise; this is how long we let it go unkept. */
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const reports = useReportStore();
  const flaggedClosed = id ? reports.reportedClosed(id) : false;
  const confirmedAt = id ? reports.confirmedOpenAt(id) : null;

  useEffect(() => { savedStore.hydrate(); intents.hydrate(); reports.hydrate(); }, []);

  useEffect(() => {
    if (!id) return;
    setLoadTimedOut(false);
    const giveUp = setTimeout(() => setLoadTimedOut(true), LOAD_GRACE_MS);
    track('place_view', { id });
    const ds = getDataSource();
    // .catch on every one of these: an unhandled rejection here used to leave
    // the screen skeletoning forever with nothing written anywhere.
    ds.getPlace(id).then((p) => {
      clearTimeout(giveUp);
      setPlace(p);
      if (!p) setLoadTimedOut(true);      // resolved, but there is no such place
      // Landmark is derived from the place's coordinates, so it chains off
      // this one fetch rather than issuing a second identical request.
      if (p) getLocalSource().nearestLandmark(p.lat, p.lng, p.ratingCount, p.id).then(setLandmark).catch(() => {});
    }).catch(() => setLoadTimedOut(true));
    ds.getGoogleReviews(id).then(setReviews).catch(() => setReviews([]));
    ds.similarNearby(id, 8).then(setSimilar).catch(() => setSimilar([]));
    return () => clearTimeout(giveUp);
  }, [id]);

  const openDirections = useCallback(() => {
    if (!place) return;
    intents.record(place.id, 'directions');
    // Deep-link to Google Maps for navigation (PRD §2.1): free, legal, and
    // better than any embedded map for turn-by-turn.
    const q = place.googlePlaceId
      ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}&query_place_id=${place.googlePlaceId}`
      : `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
    Linking.openURL(q);
  }, [place, intents]);

  /**
   * Call is the highest-intent action in the app, so it does three things:
   * records the intent (which arms the "how was it?" nudge), then dials —
   * but only after checking the device can actually place calls. On a tablet
   * or the web build `tel:` silently does nothing, which reads as a broken
   * button; there we surface the number to copy instead.
   */
  // Computed before the early return so the callbacks can close over it.
  const wa = whatsappNumber(place?.phone);

  const openWhatsApp = useCallback(() => {
    if (!place || !wa) return;
    intents.record(place.id, 'whatsapp');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(WA_GREETING)}`);
  }, [place, wa, intents]);

  const callPlace = useCallback(async () => {
    if (!place?.phone) return;
    const url = `tel:${place.phone.replace(/\s+/g, '')}`;
    intents.record(place.id, 'call');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) { await Linking.openURL(url); return; }
    } catch { /* fall through to the copy path */ }
    setCallFallback(place.phone);
  }, [place, intents]);

  if (!place) {
    /**
     * A skeleton is a promise that something is coming. When the fetch has
     * failed — no signal, a place that isn't in the offline slice — that
     * promise never resolves and the user is left staring at grey bars with
     * no way to tell whether to wait or leave. Observed offline: this screen
     * skeletoned indefinitely.
     *
     * So the skeleton is time-boxed. After LOAD_GRACE_MS it becomes an
     * answer: what happened, and the two ways out.
     */
    if (!loadTimedOut) {
      return (
        <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + space.xl, gap: space.lg }]}>
          <Skeleton w="100%" h={220} r={0} />
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <Skeleton w="70%" h={24} />
            <Skeleton w="45%" h={16} />
            <Skeleton w="60%" h={16} />
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + space.xl }]}>
        <EmptyState
          icon="wifi-off"
          title="Couldn't load this place"
          body="You may be offline, or this place isn't in the offline copy of your city. Your saved places still work."
          action={<Button label="Back to Explore" variant="tonal" onPress={goBack} />}
        />
      </View>
    );
  }

  const meta = categoryMeta[place.categoryBucket ?? 'other'] ?? categoryMeta.other;
  const open = isOpenNow(place.hours);
  const ramadan = isRamadan();
  const isFood = place.categoryBucket === 'food_drink';
  const todayHours = todaysHours(place.hours);
  const hist = parseHistogram(place.ratingHistogram);
  const facets = parseFacets(place.attributes);
  // A warning ("Cash only") earns its own line — as one chip among fifteen it
  // is exactly as loud as "Restroom", which is how people end up stranded at
  // a till with a card that isn't accepted.
  const warnings = facets.filter((f) => f.tone === 'warn');
  const { shown: shownFacets, rest: restFacets } = splitFacets(
    facets.filter((f) => f.tone !== 'warn'),
  );
  // Guard on the VALUE we render, not just the count beside it: the shelf
  // draws `fiRating ?? 0`, so a row with a count but a null average would
  // publish "0.0" as if it were a real score. Data invariants say that can't
  // happen; the shelf shouldn't depend on them holding.
  const hasFindIt = (place.fiRatingCount ?? 0) > 0 && place.fiRating != null;
  const callFirst = CALL_FIRST_BUCKETS.has(place.categoryBucket ?? '');
  const socialLink = place.socials?.find((s) => /facebook\.com/.test(s)) ?? null;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
      >
        {/* ------------------------------------------------------- hero */}
        <View style={{ height: 260, backgroundColor: c.surfaceAlt }}>
          {place.photoUrls?.length ? (
            /* Peeking edge rather than page dots: dots are weak signifiers
               that people miss, whereas a sliver of the next photo is
               self-evidently "there is more, swipe". Never auto-advances —
               auto-rotating carousels measurably cost task success. */
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={width - PHOTO_PEEK}
              decelerationRate="fast"
              onScroll={(e) => setPhotoIdx(
                Math.round(e.nativeEvent.contentOffset.x / (width - PHOTO_PEEK)) + 1,
              )}
              scrollEventThrottle={64}
            >
              {place.photoUrls.slice(0, 8).map((u, i) => (
                <Image
                  key={i}
                  source={{ uri: u }}
                  style={{ width: width - PHOTO_PEEK, height: 260 }}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="disk"
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.heroEmpty}>
              <Icon name={categoryIcon[place.categoryBucket ?? 'other']} size={40} color={c.textFaint} />
            </View>
          )}

          {/* Scrim: warm (choc-1000, not black) so the fade doesn't grey out a
              warm photo, and weighted toward the bottom rather than a linear
              50/50 ramp — a linear scrim visibly bands on gradients. */}
          <LinearGradient
            pointerEvents="none"
            colors={[photoScrim, 'transparent']}
            locations={[0, 0.42]}
            style={styles.heroScrimTop}
          />

          <View style={[styles.heroBar, { top: insets.top + space.sm }]}>
            <Tap onPress={goBack} haptic="light" scaleTo={0.92}
              style={[styles.circleBtn, curve, { backgroundColor: c.surface }, shadow(sch, 2)]}>
              <Icon name="chevron-left" size={20} color={c.textHeading} />
            </Tap>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Tap
                onPress={async () => {
                  const res = await sharePlace(place, landmark);
                  if (res !== 'cancelled') track('place_share', { id: place.id, via: res });
                  // Only the clipboard fallback needs feedback — a native share
                  // sheet is its own confirmation.
                  if (res === 'copied') {
                    setToast('Link copied');
                    setTimeout(() => setToast(null), 1800);
                  }
                }}
                haptic="light"
                scaleTo={0.92}
                accessibilityLabel={`Share ${place.name}`}
                style={[styles.circleBtn, curve, { backgroundColor: c.surface }, shadow(sch, 2)]}
              >
                <Icon name="share-2" size={17} color={c.textHeading} />
              </Tap>
              <Tap
                onPress={() => id && savedStore.toggleSave(id)}
                haptic="medium"
                scaleTo={0.92}
                accessibilityLabel={saved ? 'Remove from saved' : 'Save place'}
                style={[styles.circleBtn, curve, { backgroundColor: c.surface }, shadow(sch, 2)]}
              >
                {/* Bookmark, not a heart: the feature is called "Saved"
                    everywhere else in the product (screen title, Explore
                    pill, accessibility labels), and one action must not have
                    two symbols. Caramel when set — the app's "active" tone;
                    the red here was c.closed, the CLOSED-status colour. */}
                <Icon name="bookmark" size={18} color={saved ? c.accentText : c.textHeading} />
              </Tap>
            </View>
          </View>

          {place.photoUrls?.length > 1 ? (
            <View style={[styles.photoCount, curve, { backgroundColor: c.scrim }]}>
              <Txt variant="caption" color={cream[50]}>
                {photoIdx}/{Math.min(place.photoUrls.length, 8)}
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Believe the reporter immediately — if someone took the trouble to
            tell us a place has closed, showing it as normal makes the report
            feel ignored and they won't do it again. */}
        {flaggedClosed ? (
          <View style={[styles.closedBanner, { backgroundColor: c.closedBg, borderColor: c.border }]}>
            <Icon name="alert-circle" size={16} color={c.closed} />
            <Txt variant="label" color={c.closed} style={{ flex: 1 }}>
              You reported this as closed — we're checking
            </Txt>
          </View>
        ) : null}

        {/* --------------------------------------------------- identity
            No entrance animation here on purpose. This is the primary content
            the user opened the screen for, so fading it in only delays
            comprehension — and Reanimated's `entering` sets
            `visibility: hidden` as its initial state, which on React Native
            Web never clears, hiding the block outright. Animate novelty, not
            the thing being looked for. */}
        <View style={styles.section}>
          {/* Serif carries place identity — the one editorial moment per screen */}
          <Txt variant="serifLg">{place.name}</Txt>
          <Txt variant="body" muted>
            {[categoryLabel(place), formatPrice(place.priceRange),
              formatDistance(place.distanceM)].filter(Boolean).join(' · ')}
          </Txt>

          {/* What people actually PAID, mined from review text. Shown only
              when the mined range passed the pipeline's sanity gates —
              a concrete rupee band beats Google's $ estimate wherever both
              exist, but it renders as a supplement, labelled with its
              provenance, not as an official price. */}
          {place.priceMentions ? (
            <View style={styles.mentionRow}>
              <Icon name="tag" size={13} color={c.accentText} muted />
              <Txt variant="caption" muted>
                People mention Rs {place.priceMentions[0].toLocaleString()}–
                {place.priceMentions[1].toLocaleString()}
                {' · '}{place.priceMentions[2]} reviews
              </Txt>
            </View>
          ) : null}

          {/* two rating shelves, never blended into one number */}
          <View style={styles.ratingRow}>
            {hasFindIt ? (
              <View style={styles.ratingBlock}>
                <RatingPill value={place.fiRating ?? 0} size="lg" />
                <Txt variant="caption" muted>{place.fiRatingCount} on FIND IT</Txt>
              </View>
            ) : null}
            {place.rating != null ? (
              <View style={styles.ratingBlock}>
                <RatingPill value={place.rating} size="lg" />
                {/* Under ~20 ratings the average isn't trustworthy and people
                    know it — 47% won't consider a business below that bar. Say
                    so rather than presenting a 5.0-from-3 as equivalent. */}
                <Txt variant="caption" muted={(place.ratingCount ?? 0) >= 20} faint={(place.ratingCount ?? 0) < 20}>
                  {(place.ratingCount ?? 0) < 20
                    ? `Only ${place.ratingCount ?? 0} rating${place.ratingCount === 1 ? '' : 's'} on Google`
                    : `${place.ratingCount?.toLocaleString()} on Google`}
                </Txt>
              </View>
            ) : null}
          </View>

          {/* Open state + TODAY'S ACTUAL HOURS, both without a tap.
              93% of people check opening hours and 76% have turned up at a
              closed business because listed hours were wrong — so the times
              themselves are primary information, not something to collapse.
              Colour is never the only signal: there's a dot and a word. */}
          <Tap onPress={() => setShowHours((s) => !s)} haptic="selection" scaleTo={0.97} style={{ alignSelf: 'flex-start' }}>
            <View style={styles.openRow}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: open === true ? c.open : open === false ? c.closed : c.textFaint,
              }} />
              <Txt variant="label" color={open === true ? c.open : open === false ? c.closed : c.textMuted}>
                {open === true ? 'Open now' : open === false ? 'Closed' : 'Hours unknown'}
              </Txt>
              {todayHours ? (
                <>
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: c.textFaint }} />
                  <Txt variant="label" muted>{todayHours}</Txt>
                </>
              ) : null}
              {place.hours ? (
                <Icon name={showHours ? 'chevron-up' : 'chevron-down'} size={14} color={c.textMuted} muted />
              ) : null}
            </View>
          </Tap>
          {showHours && place.hours ? (
            <View style={[styles.hours, { borderColor: c.border }]}>
              {parseHours(place.hours).map(({ day, text }) => (
                <View key={day} style={styles.hourRow}>
                  <Txt variant="caption" muted={day !== TODAY_KEY}>{DAY_NAME[day]}</Txt>
                  <Txt variant="caption" muted={day !== TODAY_KEY}>{text}</Txt>
                </View>
              ))}
            </View>
          ) : null}

          {/* Ramadan: listed hours describe the other eleven months. An honest
              caveat beats false precision — we don't know each place's iftar
              schedule, and food places especially invert their whole day. */}
          {ramadan && place.hours ? (
            <View style={[styles.ramadanNote, curve, { backgroundColor: c.surfaceAlt }]}>
              <Icon name="moon" size={13} color={c.accentText} muted />
              <Txt variant="caption" muted style={{ flex: 1 }}>
                Ramadan — hours often shift{isFood ? ', many kitchens open after iftar' : ''}.
                {place.phone ? ' Call ahead to confirm.' : ''}
              </Txt>
            </View>
          ) : null}
        </View>

        {/* ---- action row ----
            Also mirrored in a sticky bottom bar once this scrolls away (see
            below): ~49% of people use a phone one-handed and the bottom-centre
            is the only strain-free zone, so the primary actions must never be
            more than a thumb-flick away. */}
        <View
          style={[styles.actions, { borderColor: c.border }]}
          onLayout={(e) => { actionsY.value = e.nativeEvent.layout.y; }}
        >
          {/* Which action leads depends on the category. You phone a clinic or
              a mechanic to ask a question first; you navigate to a café.
              Fixing one order for both makes the app wrong half the time. */}
          {callFirst && (wa || place.phone) ? (
            <>
              {wa
                ? <Button label="WhatsApp" icon="message-circle" onPress={openWhatsApp} flex />
                : <Button label="Call" icon="phone" onPress={callPlace} flex />}
              <Button label="Directions" icon="navigation" variant="tonal" flex onPress={openDirections} />
            </>
          ) : (
            <>
              <Button label="Directions" icon="navigation" onPress={openDirections} flex />
              {wa ? (
                <Button label="WhatsApp" icon="message-circle" variant="tonal" flex onPress={openWhatsApp} />
              ) : place.phone ? (
                <Button label="Call" icon="phone" variant="tonal" flex onPress={callPlace} />
              ) : null}
            </>
          )}
          {place.menuUrl ? (
            <Button label="Menu" icon="book-open" variant="tonal" flex
              onPress={() => { intents.record(place.id, 'menu'); Linking.openURL(place.menuUrl!); }} />
          ) : null}
          {place.website && !place.menuUrl ? (
            <Button label="Website" icon="globe" variant="tonal" flex
              onPress={() => { intents.record(place.id, 'website'); Linking.openURL(place.website!); }} />
          ) : null}
        </View>

        {/* Dialling unavailable (tablet / web): show the number rather than
            leaving a button that appears to do nothing. */}
        {callFallback ? (
          <Animated.View entering={enter(FadeIn.duration(200))} style={styles.section}>
            <Card style={{ padding: space.lg, gap: space.sm }}>
              <Txt variant="label" muted>THIS DEVICE CAN'T PLACE CALLS</Txt>
              <Txt variant="title">{callFallback}</Txt>
              <Button label="Done" variant="ghost" onPress={() => setCallFallback(null)} />
            </Card>
          </Animated.View>
        ) : null}

        {place.description ? (
          <View style={styles.section}>
            <ClampText lines={2} surface={c.bg}>{place.description}</ClampText>
          </View>
        ) : null}

        {/* ---- busy now ---- */}
        {place.popularTimes?.length ? (
          <View style={styles.section}>
            <PopularTimes data={place.popularTimes} />
          </View>
        ) : null}

        {/* ---- what's here: warnings first, then the facets that change a
                decision. Google emits ~160 of these and most are noise, so
                the list is curated and ranked in data/facets.ts. ---- */}
        {facets.length || place.cardsOk ? (
          <View style={styles.section}>
            <Txt variant="overline" muted>WHAT'S HERE</Txt>

            {warnings.map((f) => (
              <View
                key={f.key}
                style={[styles.warnRow, curve, { backgroundColor: c.closedBg, borderColor: c.border }]}
              >
                <Icon name={f.icon} size={16} color={c.closed} />
                <Txt variant="label" color={c.closed}>{f.label}</Txt>
              </View>
            ))}

            <View style={styles.wrap}>
              {place.cardsOk && !facets.some((f) => f.key === 'cards' || f.key === 'cash') ? (
                <Chip label="Cards accepted" icon="credit-card" tint={c.open} />
              ) : null}
              {(showAllAttrs ? [...shownFacets, ...restFacets] : shownFacets).map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  icon={f.icon}
                  tint={f.tone === 'good' ? c.open : undefined}
                />
              ))}
              {!showAllAttrs && restFacets.length ? (
                <Chip label={`+${restFacets.length} more`} onPress={() => setShowAllAttrs(true)} />
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ---------------------------------------------------- reviews */}
        <View style={styles.section}>
          <View style={styles.tabRow}>
            <Tap onPress={() => setTab('findit')} haptic="selection">
              <Txt variant="heading" color={tab === 'findit' ? c.text : c.textFaint}>FIND IT</Txt>
            </Tap>
            <Tap onPress={() => setTab('google')} haptic="selection">
              <Txt variant="heading" color={tab === 'google' ? c.text : c.textFaint}>Google</Txt>
            </Tap>
          </View>

          {tab === 'google' ? (
            <>
              {/* Histogram is proof, not headline — one tap away. */}
              {hist ? (
                <>
                  <Tap onPress={() => setShowHist((v) => !v)} haptic="selection" scaleTo={0.98}>
                    <View style={styles.histToggle}>
                      <Txt variant="caption" muted>Rating breakdown</Txt>
                      <Icon name={showHist ? 'chevron-up' : 'chevron-down'} size={14} color={c.textMuted} muted />
                    </View>
                  </Tap>
                  {showHist ? (
                    <Animated.View entering={enter(FadeIn.duration(180))} style={{ gap: 5, marginBottom: space.sm }}>
                      {[5, 4, 3, 2, 1].map((star) => {
                        const n = hist[String(star)] ?? 0;
                        const total = Object.values(hist).reduce((a, b) => a + b, 0) || 1;
                        return (
                          <View key={star} style={styles.histRow}>
                            <Txt variant="caption" muted>{star}</Txt>
                            <View style={[styles.histTrack, { backgroundColor: c.surfaceAlt }]}>
                              <View style={[styles.histFill, { width: `${(n / total) * 100}%`, backgroundColor: c.star }]} />
                            </View>
                            <Txt variant="caption" faint>{n.toLocaleString()}</Txt>
                          </View>
                        );
                      })}
                    </Animated.View>
                  ) : null}
                </>
              ) : null}

              {reviews.length ? (
                <View style={{ gap: space.md }}>
                  {/* ONE review by default: a wall of reviews is noise, and the
                      first one is the only one most people read. */}
                  {reviews.slice(0, showAllReviews ? 6 : 1).map((r, i) => (
                    <Card key={i} style={{ padding: space.lg, gap: 7 }}>
                      <View style={styles.revHead}>
                        <Txt variant="label">{r.author ?? 'Google user'}</Txt>
                        {r.rating != null ? <Stars value={r.rating} /> : null}
                      </View>
                      {r.when ? <Txt variant="caption" faint>{r.when}</Txt> : null}
                      <ClampText lines={2}>{r.text}</ClampText>
                    </Card>
                  ))}

                  {!showAllReviews && reviews.length > 1 ? (
                    <Button
                      label={`See ${reviews.length - 1} more review${reviews.length - 1 === 1 ? '' : 's'}`}
                      variant="tonal"
                      onPress={() => setShowAllReviews(true)}
                    />
                  ) : null}

                  {showAllReviews ? (
                    <Button label="Read all on Google Maps" icon="external-link" variant="ghost" onPress={openDirections} />
                  ) : null}

                  <Txt variant="caption" faint style={{ textAlign: 'center' }}>
                    From Google · shown with attribution
                  </Txt>
                </View>
              ) : (
                <Txt variant="body" muted>No Google reviews yet.</Txt>
              )}
            </>
          ) : myReview ? (
            <Card style={{ padding: space.md, gap: 6 }}>
              <View style={styles.revHead}>
                <Txt variant="label">Your review</Txt>
                <Stars value={myReview.stars} />
              </View>
              {myReview.tags.length ? (
                <View style={styles.wrap}>
                  {myReview.tags.map((t) => <Chip key={t} label={t} />)}
                </View>
              ) : null}
              {myReview.body ? <Txt variant="body" muted>{myReview.body}</Txt> : null}
              <Button
                label="Edit review"
                variant="ghost"
                onPress={() => router.push({ pathname: '/review/[id]', params: { id: place.id } })}
              />
            </Card>
          ) : (
            <EmptyState
              icon="edit-3"
              title="Be the first to review"
              body="Tap a few tags — it takes 30 seconds and helps everyone in your city."
              action={
                <Button
                  label="Write a review"
                  variant="tonal"
                  onPress={() => router.push({ pathname: '/review/[id]', params: { id: place.id } })}
                />
              }
            />
          )}
        </View>

        {/* -------------------------------------------------- mini map */}
        <View style={[styles.miniMap, { borderColor: c.border }]}>
          {/* The map is an enhancement, not the payload — if WebGL fails the
              name, hours and Directions must still be here. */}
          <MapBoundary onOpenExternal={openDirections}>
            <Map
              center={[place.lng, place.lat]}
              zoom={15}
              places={[place]}
              interactive={false}
              showUser={false}
            />
          </MapBoundary>
          <Tap onPress={openDirections} haptic="light" style={StyleSheet.absoluteFill}>
            <View />
          </Tap>
        </View>
        {/* ---- contact: values as TEXT, not just buttons ----
            The phone number is shown, not hidden behind the Call button.
            It's a verification affordance (people check a number before
            trusting it), it's long-press-copyable, and it's the only usable
            path on a device with no dialler. 66% of people lose trust in a
            listing over a wrong phone number, so the number has to be
            checkable without committing to a call. */}
        <View style={styles.section}>
          <Txt variant="overline" muted>CONTACT</Txt>
          {/* Landmark first — it's how people here actually navigate, and it's
              usually more useful than the postal-style address above it. */}
          {landmark ? (
            <InfoRow
              icon="navigation-2"
              value={`${formatDistance(landmark.distanceM)} from ${landmark.name}`}
              onPress={openDirections}
              c={c}
            />
          ) : null}
          {place.address ? (
            <InfoRow icon="map-pin" value={place.address} onPress={openDirections} c={c} />
          ) : null}
          {place.phone ? (
            <InfoRow icon="phone" value={formatPhone(place.phone)} onPress={callPlace} c={c} />
          ) : null}
          {wa ? (
            <InfoRow icon="message-circle" value="Message on WhatsApp" onPress={openWhatsApp} c={c} />
          ) : null}
          {place.website ? (
            <InfoRow
              icon="globe"
              value={place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              onPress={() => { intents.record(place.id, 'website'); Linking.openURL(place.website!); }}
              c={c}
            />
          ) : null}
          {/* A Facebook page is often the ONLY web presence a small business
              here has — it's where their menu, prices and messaging live. We
              already carry it for about half of all places, so surface it. */}
          {socialLink ? (
            <InfoRow
              icon="facebook"
              value="Facebook page"
              onPress={() => { intents.record(place.id, 'website'); Linking.openURL(socialLink); }}
              c={c}
            />
          ) : null}
        </View>

        {/* ------------------------------------------- similar nearby
            When THIS place is closed (or the user just reported it closed),
            the rail turns into the rescue: open alternatives first, and the
            heading says so. Dead end → next option in one glance. */}
        {similar.length ? (
          <View style={{ gap: space.sm, paddingBottom: space.lg }}>
            <Txt variant="label" muted style={{ paddingHorizontal: space.lg }}>
              {(open === false || flaggedClosed) ? 'OPEN NOW NEARBY' : 'SIMILAR NEARBY'}
            </Txt>
            {((open === false || flaggedClosed)
              ? [...similar].sort((a, b) =>
                  Number(isOpenNow(b.hours) === true) - Number(isOpenNow(a.hours) === true))
              : similar
            ).slice(0, 5).map((p, i) => (
              <PlaceCard
                key={p.id}
                place={p}
                index={i}
                onPress={() => router.push({ pathname: '/place/[id]', params: { id: p.id } })}
              />
            ))}
          </View>
        ) : null}

        <Tap
          onPress={() => setReportOpen(true)}
          haptic="light"
          scaleTo={0.98}
          accessibilityRole="button"
          style={styles.reportBtn}
        >
          <Icon name="flag" size={14} color={c.textMuted} muted />
          <Txt variant="label" muted>Something wrong? Suggest an edit</Txt>
        </Tap>

        {/* The good-news counterpart to "suggest an edit": one tap, no
            account, no form. Every other signal a user can send about
            scraped data makes it LESS trusted; this is the only one that
            heals it. Hidden once the same user flagged it closed — the two
            claims contradict. */}
        {!flaggedClosed ? (
          confirmedAt ? (
            <View style={styles.confirmRow}>
              <Icon name="check-circle" size={14} color={c.open} />
              <Txt variant="label" color={c.open}>
                You confirmed it was open {freshnessLabel(Math.floor(confirmedAt / 86_400_000))}
              </Txt>
            </View>
          ) : (
            <Tap
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                if (id) reports.submit(id, 'open_ok');
              }}
              haptic="none"
              scaleTo={0.98}
              accessibilityRole="button"
              accessibilityLabel="Confirm this place was open"
              style={styles.confirmRow}
            >
              <Icon name="check-circle" size={14} color={c.textMuted} muted />
              <Txt variant="label" muted>Been here? Tap if it was open</Txt>
            </Tap>
          )
        ) : null}

        <Freshness place={place} />
      </Animated.ScrollView>

      {id ? (
        <ReportSheet
          visible={reportOpen}
          placeId={id}
          placeName={place.name}
          onClose={() => setReportOpen(false)}
        />
      ) : null}

      {toast ? (
        <Animated.View
          pointerEvents="none"
          entering={enter(FadeIn.duration(160))}
          exiting={enter(FadeOut.duration(220))}
          style={[
            styles.toast, curve,
            { bottom: insets.bottom + 96, backgroundColor: c.textHeading },
          ]}
        >
          <Txt variant="label" color={c.bg}>{toast}</Txt>
        </Animated.View>
      ) : null}

      {/* Sticky primary actions — fades in once the inline row has scrolled
          past, so the two never appear at once. Driven entirely by a shared
          value on the UI thread: putting scroll position in React state
          re-renders the whole screen on every frame. */}
      {place.phone || true ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.stickyBar,
            { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + space.sm },
            shadow(sch, 3),
            stickyStyle,
          ]}
        >
          <Button label="Directions" icon="navigation" onPress={openDirections} flex />
          {place.phone ? (
            <Tap onPress={callPlace} haptic="medium" scaleTo={0.94}
              style={[styles.stickyIcon, curve, { backgroundColor: c.accentWash }]}>
              <Icon name="phone" size={19} color={c.textHeading} />
            </Tap>
          ) : null}
          <Tap onPress={() => id && savedStore.toggleSave(id)} haptic="medium" scaleTo={0.94}
            style={[styles.stickyIcon, curve, { backgroundColor: c.accentWash }]}>
            <Icon name="bookmark" size={19} color={saved ? c.accentText : c.textHeading} />
          </Tap>
        </Animated.View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ helpers */

/** A tappable fact row: icon + the actual value, never a bare button. */
function InfoRow({
  icon, value, onPress, c,
}: { icon: IconName; value: string; onPress?: () => void; c: ReturnType<typeof colors> }) {
  return (
    <Tap onPress={onPress} haptic="light" scaleTo={0.99} style={styles.infoRow}>
      <Icon name={icon} size={16} color={c.textMuted} muted />
      <Txt variant="body" muted style={{ flex: 1 }} numberOfLines={2}>{value}</Txt>
      <Icon name="chevron-right" size={15} color={c.textFaint} muted />
    </Tap>
  );
}

/**
 * Group Pakistani numbers so they can be read and checked at a glance.
 * The pipeline normalises to bare digits ("923111117546"), so accept that as
 * well as +92 / 0-prefixed input. Dialling always uses the raw value.
 */
function formatPhone(raw: string): string {
  const d = raw.replace(/[^\d]/g, '');
  // 92 + 10 national digits  ->  +92 311 1117546
  const intl = /^92(\d{3})(\d{7})$/.exec(d);
  if (intl) return `+92 ${intl[1]} ${intl[2]}`;
  // 0 + 10 national digits   ->  0311 1117546
  const local = /^0(\d{3})(\d{7})$/.exec(d);
  if (local) return `0${local[1]} ${local[2]}`;
  // Landlines: 92 + area(2-3) + 7-8 digits
  const land = /^92(\d{2,3})(\d{6,8})$/.exec(d);
  if (land) return `+92 ${land[1]} ${land[2]}`;
  return raw;
}

function parseHistogram(s?: string | null): Record<string, number> | null {
  if (!s) return null;
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/** Today's opening times, pulled out of the compact hours string. */
function todaysHours(h?: string | null): string | null {
  if (!h) return null;
  const key = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'][new Date().getDay()];
  for (const seg of h.split('|')) {
    const i = seg.indexOf(':');
    if (i > 0 && seg.slice(0, i) === key) {
      const v = seg.slice(i + 1).trim();
      return /closed/i.test(v) ? null : v;
    }
  }
  return null;
}

function parseHours(h: string): { day: string; text: string }[] {
  const map: Record<string, string> = {};
  for (const seg of h.split('|')) {
    const i = seg.indexOf(':');
    if (i > 0) map[seg.slice(0, i)] = seg.slice(i + 1);
  }
  return DAY_ORDER.filter((d) => map[d]).map((d) => ({ day: d, text: map[d] }));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroScrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  heroBar: {
    position: 'absolute', left: space.lg, right: space.lg,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  photoCount: {
    // `end`, not `right`: this is the only single-sided absolute position in
    // the app, so it is the only one that would stay pinned to the wrong
    // corner under RTL. Every other left/right here is a symmetric pair and
    // flips for free. Urdu is RTL and we render Urdu names today.
    position: 'absolute', bottom: space.md, end: space.md,
    paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.xs,
  },
  section: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.sm },
  ratingRow: { flexDirection: 'row', gap: space.xl, marginTop: space.sm },
  ratingBlock: { gap: 4, alignItems: 'flex-start' },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: 11, minHeight: 48,
  },
  stickyBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stickyIcon: {
    width: 50, height: 50, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  closedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.lg,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
  ramadanNote: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: 9,
    borderRadius: radius.md, marginTop: space.sm,
  },
  warnRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, alignSelf: 'flex-start',
  },
  toast: {
    position: 'absolute', alignSelf: 'center',
    paddingHorizontal: space.lg, paddingVertical: 11, borderRadius: radius.lg,
  },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  confirmRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: space.sm, minHeight: 44,
  },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: space.lg, marginTop: space.sm,
  },
  hours: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg },
  actions: {
    flexDirection: 'row', gap: space.sm, padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, marginTop: space.sm,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tabRow: { flexDirection: 'row', gap: space.xl, marginBottom: space.sm },
  histToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', paddingVertical: space.xs,
  },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  histTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  histFill: { height: 6, borderRadius: 3 },
  revHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  miniMap: {
    height: 160, marginHorizontal: space.lg, marginTop: space.lg,
    borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1,
  },
});
