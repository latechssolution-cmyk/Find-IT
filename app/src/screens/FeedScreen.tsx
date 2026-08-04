/**
 * Photo feed — nearby posts, newest first.
 *
 * UNROUTED until FEATURES.FEED is on: the route file redirects home when the
 * flag is off, so this screen can be finished and reviewed without shipping.
 *
 * Design notes:
 *  - photos dominate; chrome is one thin row under each. This is a feed of
 *    PLACES, so the place name is the primary line, not the author — the
 *    tap goes to the place screen, which is where the app makes its money.
 *  - single column. A masonry grid looks busier but halves photo size, and
 *    these are 1080-wide food/shopfront shots, not thumbnails.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { colors, curve, radius, space } from '../theme';
import { fetchFeed, reportPost, type FeedPost } from '../data/feed';
import { formatDistance } from '../ui/PlaceCard';
import { Icon } from '../ui/Icon';
import { EmptyState, RatingPill, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { useLocationStore } from '../hooks/useLocation';

export default function FeedScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useBack('/');
  const { width } = useWindowDimensions();
  const { coords } = useLocationStore();

  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!coords) { setPosts([]); return; }
    const rows = await fetchFeed(coords.lat, coords.lng);
    setPosts(rows);
  }, [coords?.lat, coords?.lng]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const photoW = width - space.lg * 2;

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92} style={styles.backBtn}>
          <Icon name="chevron-left" size={20} color={c.textHeading} />
        </Tap>
        <Txt variant="title">Nearby photos</Txt>
        <View style={{ width: 36 }} />
      </View>

      {posts === null ? (
        <View style={{ padding: space.lg, gap: space.lg }}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.skeleton, curve, { backgroundColor: c.surfaceAlt, height: photoW * 0.75 }]} />
          ))}
        </View>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="camera"
          title="No photos here yet"
          body="Photos people post at places nearby will show up here."
        />
      ) : (
        <FlashList
          data={posts}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textMuted} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              photoW={photoW}
              onOpenPlace={() => router.push({ pathname: '/place/[id]', params: { id: item.placeId } })}
            />
          )}
        />
      )}
    </View>
  );
}

function PostCard({ post, photoW, onOpenPlace }: {
  post: FeedPost; photoW: number; onOpenPlace: () => void;
}) {
  const sch = useScheme();
  const c = colors(sch);
  const [reported, setReported] = useState(false);

  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm }}>
      <View style={[styles.photoWrap, curve, { backgroundColor: c.surfaceAlt }]}>
        <Image
          source={{ uri: post.photoUrl }}
          style={{ width: photoW, height: photoW * 0.75 }}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          recyclingKey={post.id}
        />
      </View>

      {/* One row of chrome: the place IS the point. */}
      <Tap onPress={onOpenPlace} haptic="light" scaleTo={0.99} style={styles.metaRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading" numberOfLines={1}>{post.placeName}</Txt>
          <View style={styles.subRow}>
            {post.stars != null ? <RatingPill value={post.stars} /> : null}
            {post.distanceM != null ? (
              <Txt variant="caption" muted>{formatDistance(post.distanceM)}</Txt>
            ) : null}
          </View>
        </View>
        <Icon name="chevron-right" size={16} color={c.textFaint} muted />
      </Tap>

      {post.caption ? (
        <Txt variant="body" muted numberOfLines={3}>{post.caption}</Txt>
      ) : null}

      <Tap
        onPress={async () => { setReported(true); await reportPost(post.id, 'inappropriate'); }}
        haptic="selection"
        style={{ alignSelf: 'flex-end' }}
        accessibilityRole="button"
        accessibilityLabel="Report this photo"
      >
        <Txt variant="caption" faint>{reported ? 'Reported — thanks' : 'Report'}</Txt>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  photoWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  skeleton: { borderRadius: radius.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
