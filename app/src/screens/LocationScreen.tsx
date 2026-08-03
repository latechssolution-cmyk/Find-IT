/**
 * Location + radius picker (PRD §5.3) — the flagship interaction.
 *
 * The pin does NOT drag: it is fixed at screen centre and the MAP pans
 * underneath it (the Uber/Careem pattern). Dragging a marker hides it under
 * your thumb and demands precision; panning is coarse, fast, and the pin is
 * always visible.
 *
 * Hard rule: results never exceed the circle, and the count shown is the count
 * delivered. A "soft" radius destroys trust in the control.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';

import { colors, curve, motion, radius as R, shadow, space } from '../theme';
import { getLocalSource, RADIUS_STEPS } from '../data';
import { Map, type MapHandle } from '../ui/Map';
import { MapBoundary } from '../ui/MapBoundary';
import { Icon } from '../ui/Icon';
import { Button, Chip, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { reverseGeocode, useLocationStore, type Coords } from '../hooks/useLocation';
import { track } from '../hooks/analytics';

/** Cities with bundled data. Hopping between them by panning would mean
 *  dragging the map across half of Punjab — one tap instead. */
const CITY_HOPS: { label: string; coords: Coords }[] = [
  { label: 'Faisalabad', coords: { lat: 31.418, lng: 73.079 } },
  { label: 'Islamabad', coords: { lat: 33.6938, lng: 73.0652 } },
  { label: 'Rawalpindi', coords: { lat: 33.5977, lng: 73.0479 } },
  { label: 'Lahore', coords: { lat: 31.5204, lng: 74.3587 } },
];

export default function LocationScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useBack('/');
  const mapRef = useRef<MapHandle>(null);

  const store = useLocationStore();
  const [center, setCenter] = useState<Coords>(store.coords ?? { lat: 31.418, lng: 73.079 });
  const [radiusM, setRadiusM] = useState(store.radiusM);
  const [label, setLabel] = useState<string | null>(store.label);
  const [count, setCount] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);

  const lift = useSharedValue(0);
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value }, { scale: 1 + lift.value / 100 }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + lift.value / 40,
    transform: [{ scale: 1 - lift.value / 40 }],
  }));

  /* --- pan start: pin lifts, circle dims, label goes provisional --- */
  const onRegionStart = useCallback(() => {
    lift.value = withTiming(11, { duration: motion.pinLift });
    setSettling(true);
  }, [lift]);

  /* --- pan end (debounced): pin drops + haptic, then geocode + count --- */
  const onRegionChange = useCallback((ctr: [number, number]) => {
    lift.value = withSpring(0, motion.pinDrop);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = { lat: ctr[1], lng: ctr[0] };
    setCenter(next);
    setSettling(false);

    if (geoTimer.current) clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(async () => {
      const l = await reverseGeocode(next);
      if (l) setLabel(l);
    }, 400);
  }, [lift]);

  /* --- live "N places within X km" (debounced 200 ms) --- */
  useEffect(() => {
    if (countTimer.current) clearTimeout(countTimer.current);
    // Show "…" straight away: a lazy city bundle can take a moment to hydrate
    // on first touch, and a stale count that flips later reads as a glitch.
    setCount(null);
    countTimer.current = setTimeout(async () => {
      const n = await getLocalSource().countWithin(center.lat, center.lng, radiusM);
      setCount(n);
    }, 200);
    return () => { if (countTimer.current) clearTimeout(countTimer.current); };
  }, [center.lat, center.lng, radiusM]);

  const commit = () => {
    store.setManual(center, label);
    store.setRadius(radiusM);
    goBack();
  };

  const useMyLocation = async () => {
    const ok = await store.request();
    if (ok && store.coords) {
      setCenter(store.coords);
      setLabel(store.label);
      mapRef.current?.flyTo(store.coords.lng, store.coords.lat, 14);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {/* Picking a point without a map is impossible, so the fallback card
          is the honest answer here — the city shortcuts below still work. */}
      <MapBoundary>
        <Map
          ref={mapRef}
          center={[center.lng, center.lat]}
          zoom={13}
          radiusM={radiusM}
          onRegionChangeStart={onRegionStart}
          onRegionChange={onRegionChange}
          showUser
        />
      </MapBoundary>

      {/* fixed centre pin — an overlay, NOT a map marker */}
      <View pointerEvents="none" style={styles.pinWrap}>
        <Animated.View style={[styles.pin, pinStyle]}>
          <View style={[styles.pinHead, { backgroundColor: c.accent, borderColor: c.surface }]} />
          <View style={[styles.pinStem, { backgroundColor: c.accent }]} />
        </Animated.View>
        <Animated.View style={[styles.pinShadow, shadowStyle]} />
      </View>

      {/* top bar */}
      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92}
          style={[styles.circleBtn, curve, { backgroundColor: c.surface }, shadow(sch, 2)]}>
          <Icon name="chevron-left" size={20} color={c.textHeading} />
        </Tap>
        <Tap onPress={useMyLocation} haptic="light" scaleTo={0.92}
          style={[styles.circleBtn, curve, { backgroundColor: c.surface }, shadow(sch, 2)]}>
          <Icon name="crosshair" size={18} color={c.accentText} />
        </Tap>
      </View>

      {/* bottom card */}
      <View style={[styles.card, {
        backgroundColor: c.surface, borderColor: c.border,
        paddingBottom: insets.bottom + space.lg,
      }, shadow(sch, 3)]}>
        <View style={styles.hopRow}>
          {CITY_HOPS.map((h) => (
            <Chip
              key={h.label}
              label={h.label}
              active={label === h.label}
              onPress={() => {
                track('city_hop', { city: h.label });
                setCenter(h.coords);
                setLabel(h.label);
                mapRef.current?.flyTo(h.coords.lng, h.coords.lat, 12);
              }}
            />
          ))}
        </View>

        <Txt variant="caption" muted>SEARCHING AROUND</Txt>
        <Txt variant="title" numberOfLines={1}>
          {settling ? 'Locating…' : (label ?? 'Dropped pin')}
        </Txt>

        <View style={styles.countRow}>
          <Txt variant="body" color={c.accent}>
            {count == null ? '…' : `${count.toLocaleString()} place${count === 1 ? '' : 's'}`}
          </Txt>
          <Txt variant="body" muted> within {(radiusM / 1000).toFixed(radiusM < 1000 ? 1 : 0)} km</Txt>
        </View>

        <Slider
          value={RADIUS_STEPS.indexOf(radiusM) >= 0 ? RADIUS_STEPS.indexOf(radiusM) : 2}
          minimumValue={0}
          maximumValue={RADIUS_STEPS.length - 1}
          step={1}
          minimumTrackTintColor={c.accent}
          maximumTrackTintColor={c.border}
          thumbTintColor={c.accent}
          onValueChange={(v) => {
            const next = RADIUS_STEPS[Math.round(v)];
            if (next !== radiusM) {
              setRadiusM(next);
              Haptics.selectionAsync();
            }
          }}
          style={{ marginVertical: space.sm }}
        />
        <View style={styles.stepRow}>
          {RADIUS_STEPS.map((s) => (
            <Txt key={s} variant="caption" faint={s !== radiusM} muted={s === radiusM}>
              {s / 1000}km
            </Txt>
          ))}
        </View>

        <Button label="Search here" onPress={commit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pinWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 150,          // sits above the bottom card
  },
  pin: { alignItems: 'center' },
  pinHead: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  pinStem: { width: 3, height: 12, marginTop: -2, borderRadius: 2 },
  pinShadow: {
    width: 12, height: 4, borderRadius: 6, marginTop: 2,
    backgroundColor: '#000', opacity: 0.25,
  },
  topBar: {
    position: 'absolute', left: space.lg, right: space.lg,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  circleBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1,
    padding: space.lg, gap: space.xs,
  },
  countRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.xs },
  hopRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md },
});
