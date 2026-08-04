/**
 * My photos — the author's own gallery, every status visible.
 *
 * The one design rule here: a REJECTED post stays visible to its author,
 * with the reason in plain words. A photo that silently disappears reads as
 * a bug, and the author's next move is to post the same photo again — the
 * exact outcome moderation exists to prevent.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';

import { colors, curve, radius, space } from '../theme';
import { fetchMyPosts } from '../data/feed';
import { Icon } from '../ui/Icon';
import { EmptyState, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';

type MyPost = Awaited<ReturnType<typeof fetchMyPosts>>[number];

const REASON_COPY: Record<string, string> = {
  faces: 'Has people in it — photos here are of places only',
  nsfw: 'Flagged as not suitable',
  text: 'Caption was flagged',
  spam: 'Caption looked like an ad or contact details',
  reported: 'Hidden after reports from other users',
};

export default function GalleryScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const goBack = useBack('/');
  const { width } = useWindowDimensions();

  const [posts, setPosts] = useState<MyPost[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setPosts(await fetchMyPosts()); }, []);
  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  // Two-up grid: enough to scan your history, big enough to recognise shots.
  const cell = (width - space.lg * 2 - space.sm) / 2;

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92} style={styles.backBtn}>
          <Icon name="chevron-left" size={20} color={c.textHeading} />
        </Tap>
        <Txt variant="title">My photos</Txt>
        <View style={{ width: 36 }} />
      </View>

      {posts === null ? null : posts.length === 0 ? (
        <EmptyState
          icon="camera"
          title="Nothing posted yet"
          body="Photos you post at places will collect here."
        />
      ) : (
        <FlashList
          data={posts}
          numColumns={2}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textMuted} />}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xl }}
          renderItem={({ item, index }) => (
            <View style={{ width: cell, marginLeft: index % 2 ? space.sm : 0, marginTop: space.sm }}>
              <View style={[styles.cellWrap, curve, { backgroundColor: c.surfaceAlt }]}>
                <Image
                  source={{ uri: item.photoUrl }}
                  style={{ width: cell, height: cell }}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="disk"
                  recyclingKey={item.id}
                />
                {item.status !== 'live' ? (
                  <View style={[styles.badge, {
                    backgroundColor: item.status === 'pending' ? c.surface : c.closedBg,
                  }]}>
                    <Txt variant="caption" color={item.status === 'pending' ? c.textMuted : c.closed}>
                      {item.status === 'pending' ? 'Checking…' : 'Not posted'}
                    </Txt>
                  </View>
                ) : null}
              </View>
              {item.status === 'rejected' || item.status === 'hidden' ? (
                <Txt variant="caption" faint style={{ marginTop: 4 }} numberOfLines={2}>
                  {REASON_COPY[item.rejectReason ?? ''] ?? 'Not suitable for the feed'}
                </Txt>
              ) : null}
            </View>
          )}
        />
      )}
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
  cellWrap: { borderRadius: radius.md, overflow: 'hidden' },
  badge: {
    position: 'absolute', top: 6, left: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.xs,
  },
});
