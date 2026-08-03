/**
 * Explore — the structural core (PRD §5.2).
 *
 * Persistent map + three-snap bottom sheet. The map is never fully lost: the
 * sheet slides over it and stays draggable, which is the single most
 * load-bearing interaction in the app.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetFlatList, BottomSheetView } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { colors, curve, radius, shadow, space, categoryMeta } from '../theme';
import { distanceM, getDataSource, type CategoryBucket, type Place } from '../data';
import { Map, type MapHandle } from '../ui/Map';
import { PlaceCard } from '../ui/PlaceCard';
import { Icon, categoryIcon, type IconName } from '../ui/Icon';
import { ReviewNudge } from '../ui/ReviewNudge';
import { Chip, EmptyState, PlaceCardSkeleton, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { enter } from '../ui/enter';
import { reverseGeocode, useLocation } from '../hooks/useLocation';
import { track } from '../hooks/analytics';
import { FilterSheet } from '../ui/FilterSheet';
import { MapBoundary } from '../ui/MapBoundary';

/**
 * Second chip row: needs, not categories. Multi-select ANDed filters over the
 * facet layer. "Open now" is here too — it's the single most common need and
 * burying it in a filter sheet is the classic way to lose it.
 */
const NEEDS: { key: string; label: string; icon: IconName; hint?: string }[] = [
  { key: 'open', label: 'Open now', icon: 'clock' },
  { key: 'cards', label: 'Cards', icon: 'credit-card', hint: 'Card payments accepted' },
  { key: 'delivery', label: 'Delivery', icon: 'truck', hint: 'Delivers to you' },
  { key: 'halal', label: 'Halal', icon: 'check-circle', hint: 'Halal food' },
  { key: 'kids', label: 'Kids', icon: 'smile', hint: 'Good for families' },
  { key: 'parking', label: 'Parking', icon: 'square', hint: 'Has its own parking' },
  { key: 'women', label: 'Women-owned', icon: 'award', hint: 'Women-owned business' },
];

/** Everything except "Open now", which stays a first-class chip. */
const SHEET_NEEDS = NEEDS.filter((n) => n.key !== 'open');

const CHIPS: { key: CategoryBucket | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'food_drink', label: 'Food' },
  { key: 'shopping', label: 'Shops' },
  { key: 'health', label: 'Health' },
  { key: 'beauty', label: 'Beauty' },
  { key: 'education', label: 'Learn' },
  { key: 'services', label: 'Services' },
  { key: 'finance', label: 'Banks' },
  { key: 'automotive', label: 'Auto' },
];

export default function ExploreScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);

  const { coords, label, radiusM, setManual } = useLocation();
  const [cat, setCat] = useState<CategoryBucket | 'all'>('all');
  const [needs, setNeeds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openNow = needs.includes('open');
  const sheetCount = needs.filter((n) => n !== 'open').length;

  const toggleNeed = useCallback((key: string) => {
    setNeeds((prev) => {
      const on = !prev.includes(key);
      if (on) track('filter_use', { key });
      return on ? [...prev, key] : prev.filter((k) => k !== key);
    });
  }, []);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [panned, setPanned] = useState<{ lat: number; lng: number } | null>(null);
  const listRef = useRef<any>(null);

  const snapPoints = useMemo(() => ['18%', '52%', '92%'], []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ds = getDataSource();
      const res = await ds.search({
        lat: coords?.lat, lng: coords?.lng, radiusM,
        cats: cat === 'all' ? null : [cat],
        openOnly: needs.includes('open'),
        facets: needs.filter((n) => n !== 'open'),
        limit: 60,
      });
      setPlaces(res.places);
    } finally {
      setLoading(false);
    }
  }, [coords?.lat, coords?.lng, radiusM, cat, needs.join(',')]);

  useEffect(() => { load(); }, [load]);

  /**
   * Marker → list. Selecting a pin scrolls its card into view and lifts the
   * sheet: without this the map and the list are two disconnected things, and
   * the user has to hunt for the place they just tapped.
   */
  const onSelectMarker = useCallback((p: Place) => {
    setSelected(p.id);
    sheetRef.current?.snapToIndex(1);
    mapRef.current?.flyTo(p.lng, p.lat, 15);
    const idx = places.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      // The sheet needs a beat to reach its snap point before scrolling.
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
      }, 220);
    }
  }, [places]);

  /**
   * Panning the map doesn't silently re-query — it offers. An explicit
   * "Search this area" is the right default on a patchy connection, where
   * auto-searching every idle burns data and produces results the user didn't
   * ask for.
   */
  const onRegionChange = useCallback((ctr: [number, number]) => {
    const origin = coords ?? { lat: 31.418, lng: 73.079 };
    const moved = distanceM(origin.lat, origin.lng, ctr[1], ctr[0]);
    setPanned(moved > radiusM * 0.45 ? { lat: ctr[1], lng: ctr[0] } : null);
  }, [coords?.lat, coords?.lng, radiusM]);

  const searchThisArea = useCallback(() => {
    if (!panned) return;
    setManual(panned, null);
    reverseGeocode(panned).then((l: string | null) => { if (l) setManual(panned, l); });
    setPanned(null);
  }, [panned, setManual]);

  const openPlace = useCallback((p: Place) => {
    router.push({ pathname: '/place/[id]', params: { id: p.id } });
  }, [router]);

  const center: [number, number] = coords ? [coords.lng, coords.lat] : [73.079, 31.418];

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {/* If the map dies, Explore still works: the results sheet carries the
          actual answer, so the boundary renders nothing rather than an error
          card that would sit behind the sheet where no one can read it. */}
      <MapBoundary height={0}>
        <Map
          ref={mapRef}
          center={center}
          zoom={13}
          places={places}
          selectedId={selected}
          onSelect={onSelectMarker}
          onRegionChange={onRegionChange}
        />
      </MapBoundary>

      {/* "Search this area" — appears only after a meaningful pan */}
      {panned ? (
        <Animated.View
          entering={enter(FadeInDown.duration(200))}
          style={[styles.searchArea, { top: insets.top + 176 }]}
        >
          <Tap
            onPress={searchThisArea}
            haptic="light"
            scaleTo={0.95}
            style={[styles.searchAreaBtn, curve, { backgroundColor: c.brand }, shadow(sch, 2)]}
          >
            <Icon name="refresh-cw" size={14} color={c.onBrand} />
            <Txt variant="label" color={c.onBrand}>Search this area</Txt>
          </Tap>
        </Animated.View>
      ) : null}

      {/* ---- floating header: search entry + category chips ---- */}
      <View style={[styles.header, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <Tap
          onPress={() => router.push('/search')}
          haptic="light"
          scaleTo={0.985}
          style={[styles.searchBar, curve, { backgroundColor: c.surface, borderColor: c.border }, shadow(sch, 2)]}
        >
          <Icon name="search" size={17} color={c.textMuted} />
          <Txt variant="body" muted>Search places, food, shops…</Txt>
        </Tap>

        {/* One scrollable utility row instead of two stacked rows: place,
            saved, the one need everybody wants, and everything else behind
            a counted Filters pill. Reclaims ~44px of map. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
          keyboardShouldPersistTaps="handled"
        >
          <Tap
            onPress={() => router.push('/location')}
            haptic="light"
            scaleTo={0.96}
            style={[styles.locPill, curve, { backgroundColor: c.surface, borderColor: c.border }, shadow(sch, 1)]}
          >
            <Icon name="map-pin" size={12} color={c.accentText} />
            <Txt variant="caption" numberOfLines={1}>
              {/* "Search this area" clears the label and reverse-geocodes,
                  so there is a window where we do not know where the user
                  is. Falling back to a hard-coded city NAMED a place they
                  may be nowhere near; "This area" is true whatever the
                  coordinates. */}
              {label ?? 'This area'} · {(radiusM / 1000).toFixed(0)} km
            </Txt>
          </Tap>

          <Tap
            onPress={() => toggleNeed('open')}
            haptic="light"
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityState={{ selected: openNow }}
            style={[
              styles.locPill, curve,
              openNow
                ? { backgroundColor: c.brand, borderColor: c.brand }
                : { backgroundColor: c.surface, borderColor: c.border },
              shadow(sch, 1),
            ]}
          >
            <Icon name="clock" size={12} color={openNow ? c.onBrand : c.textMuted} />
            <Txt variant="caption" color={openNow ? c.onBrand : undefined}>Open now</Txt>
          </Tap>

          <Tap
            onPress={() => setFiltersOpen(true)}
            haptic="light"
            scaleTo={0.96}
            accessibilityLabel={`Filters${sheetCount ? `, ${sheetCount} active` : ''}`}
            style={[
              styles.locPill, curve,
              sheetCount
                ? { backgroundColor: c.brand, borderColor: c.brand }
                : { backgroundColor: c.surface, borderColor: c.border },
              shadow(sch, 1),
            ]}
          >
            <Icon name="sliders" size={12} color={sheetCount ? c.onBrand : c.textMuted} />
            <Txt variant="caption" color={sheetCount ? c.onBrand : undefined}>
              {sheetCount ? `Filters · ${sheetCount}` : 'Filters'}
            </Txt>
          </Tap>

          <Tap
            onPress={() => router.push('/saved')}
            haptic="light"
            scaleTo={0.96}
            style={[styles.locPill, curve, { backgroundColor: c.surface, borderColor: c.border }, shadow(sch, 1)]}
          >
            <Icon name="bookmark" size={12} color={c.textMuted} />
            <Txt variant="caption">Saved</Txt>
          </Tap>
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {CHIPS.map((ch) => (
            <Chip
              key={ch.key}
              label={ch.label}
              icon={categoryIcon[ch.key]}
              active={cat === ch.key}
              tint={ch.key === 'all' ? undefined : categoryMeta[ch.key as CategoryBucket]?.tint}
              onPress={() => setCat(ch.key as any)}
            />
          ))}
        </ScrollView>

      </View>

      <FilterSheet
        visible={filtersOpen}
        options={SHEET_NEEDS}
        selected={needs}
        onToggle={toggleNeed}
        onClear={() => setNeeds((prev) => prev.filter((k) => k === 'open'))}
        onClose={() => setFiltersOpen(false)}
        resultCount={loading ? undefined : places.length}
      />

      {/* ---- results sheet ---- */}
      <BottomSheet
        ref={sheetRef}
        index={1}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        backgroundStyle={{ backgroundColor: c.surface }}
        handleIndicatorStyle={{ backgroundColor: c.textFaint }}
        style={shadow(sch, 3)}
      >
        {loading ? (
          <BottomSheetView>
            <View style={styles.sheetHead}>
              <Txt variant="heading">Finding places…</Txt>
            </View>
            {[0, 1, 2, 3, 4].map((i) => <PlaceCardSkeleton key={i} />)}
          </BottomSheetView>
        ) : places.length === 0 ? (
          <BottomSheetView>
            <EmptyState
              icon="compass"
              title={needs.length ? 'Nothing matches those filters' : 'Nothing here yet'}
              body={needs.length
                ? 'Facet info comes from Google and many places don’t list it — try removing a filter.'
                : 'Try a wider radius or a different category.'}
            />
            {needs.length ? (
              <View style={{ alignItems: 'center', paddingBottom: space.xl }}>
                <Chip label="Clear filters" icon="x" onPress={() => setNeeds([])} />
              </View>
            ) : null}
          </BottomSheetView>
        ) : (
          /* BottomSheetFlatList, not FlashList: the sheet caps this list at
             ~60 ranked results (Airbnb's density rule), where FlatList is
             plenty fast — and FlashList v2 renders nothing inside the sheet
             on web, which would cost us the whole browser preview. */
          <BottomSheetFlatList
            ref={listRef}
            data={places}
            keyExtractor={(p: Place) => p.id}
            /* Low-end tuning: small batches keep the JS thread free while the
               map is animating. No getItemLayout — rows vary by ~20px when the
               tag row is present, and a wrong constant breaks scrollToIndex. */
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
            onScrollToIndexFailed={() => { /* list not measured yet; harmless */ }}
            /* Header belongs to the list, not a sibling view: as siblings the
               list fills the sheet and paints over the header. */
            ListHeaderComponent={
              <>
                <ReviewNudge />
                <View style={styles.sheetHead}>
                  <Txt variant="heading">
                    {places.length} place{places.length === 1 ? '' : 's'} nearby
                  </Txt>
                  <Txt variant="caption" muted>Sorted by rating, distance and what's open</Txt>
                </View>
              </>
            }
            renderItem={({ item, index }: { item: Place; index: number }) => (
              <PlaceCard
                place={item}
                index={index}
                selected={item.id === selected}
                onPress={() => openPlace(item)}
              />
            )}
            contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
          />
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { position: 'absolute', left: 0, right: 0, gap: space.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, paddingHorizontal: space.lg, minHeight: 50,
    borderRadius: radius.pill, borderWidth: 1,
  },
  pillRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  locPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.pill, borderWidth: 1, maxWidth: '68%',
  },
  chipRow: { paddingHorizontal: space.lg, gap: space.sm, paddingVertical: 2 },
  searchArea: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  searchAreaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: radius.pill,
  },
  /* Header hugs its content and is separated from what's above it — the gap
     BELOW a section header must be visibly smaller than the gap above it. */
  sheetHead: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 10, gap: 3 },
});
