/**
 * Saved places (PRD §5.8). Fully offline: saved place details are the one
 * thing that must open on a dead connection.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import { colors, radius, space } from '../theme';
import { getDataSource, type Place } from '../data';
import { PlaceCard } from '../ui/PlaceCard';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Button, EmptyState, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { useSavedStore } from '../hooks/useSaved';

export default function SavedScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useBack('/');
  const store = useSavedStore();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { store.hydrate(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ds = getDataSource();
      const ids = Object.entries(store.saved)
        .sort((a, b) => b[1].localeCompare(a[1]))    // newest first
        .map(([id]) => id);
      const found = (await Promise.all(ids.map((id) => ds.getPlace(id)))).filter(Boolean) as Place[];
      if (!cancelled) { setPlaces(found); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [store.saved, store.hydrated]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92} style={styles.headBtn}>
          <Icon name="chevron-left" size={20} color={c.textHeading} />
        </Tap>
        <Txt variant="title">Saved</Txt>
        <View style={{ width: 36 }} />
      </View>

      {/* Saved is the closest thing to a profile area, so app-level preferences
          live here rather than behind a settings screen nobody opens. */}
      <View style={styles.prefsRow}>
        <Txt variant="overline" muted>APPEARANCE</Txt>
        <ThemeToggle />
      </View>

      {loading ? null : places.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title="Nothing saved yet"
          body="Tap the bookmark on any place to keep it here — it stays available offline."
          action={<Button label="Explore nearby" variant="tonal" onPress={() => router.replace('/')} />}
        />
      ) : (
        <FlashList
          data={places}
          keyExtractor={(p: Place) => p.id}
          renderItem={({ item, index }: { item: Place; index: number }) => (
            <PlaceCard
              place={item}
              index={index}
              onPress={() => router.push({ pathname: '/place/[id]', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  headBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  prefsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md,
  },
});
