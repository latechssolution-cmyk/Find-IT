/**
 * Post a photo at a place.
 *
 * The flow is: pick → gate (on device, instant) → caption → post. The gate
 * runs at PICK time, not submit time — if the photo has a face in it, the
 * user should know before they type a caption, not after.
 *
 * On submit the post goes up as 'pending' and this screen says so honestly
 * ("We'll check it and post it shortly") rather than pretending it is live.
 */

import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';

import { colors, curve, radius, space } from '../theme';
import { createPost } from '../data/feed';
import { gatePhoto, gateMessage, type GateReason } from '../ui/photoGate';
import { Icon } from '../ui/Icon';
import { Button, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';

export default function ComposeScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const goBack = useBack('/');
  const { width } = useWindowDimensions();
  const { placeId, placeName } = useLocalSearchParams<{ placeId: string; placeName?: string }>();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [gateError, setGateError] = useState<GateReason | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const pick = useCallback(async (fromCamera: boolean) => {
    setGateError(null);
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]?.uri) return;

    // Gate NOW: a refusal at pick time costs the user two seconds; the same
    // refusal after writing a caption costs the caption too.
    const gate = await gatePhoto(res.assets[0].uri);
    if (!gate.ok || !gate.uri) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setGateError(gate.reason ?? 'unreadable');
      setPhotoUri(null);
      return;
    }
    setPhotoUri(gate.uri);
  }, []);

  const submit = useCallback(async () => {
    if (!photoUri || !placeId || busy) return;
    setBusy(true);
    try {
      const out = await createPost(photoUri, placeId, caption);
      if (out.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDone(true);
        setTimeout(goBack, 1600);
      } else if (out.reason === 'faces' || out.reason === 'nsfw' || out.reason === 'unreadable') {
        setGateError(out.reason);
        setPhotoUri(null);
      } else {
        setGateError('unreadable');
      }
    } finally {
      setBusy(false);
    }
  }, [photoUri, placeId, caption, busy, goBack]);

  const photoW = width - space.lg * 2;
  const err = gateError ? gateMessage(gateError) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}
    >
      <View style={styles.head}>
        <Tap onPress={goBack} haptic="light" scaleTo={0.92} style={styles.backBtn}>
          <Icon name="x" size={20} color={c.textHeading} />
        </Tap>
        <View style={{ alignItems: 'center' }}>
          <Txt variant="label" muted>Add a photo</Txt>
          <Txt variant="title" numberOfLines={1}>{placeName ?? 'this place'}</Txt>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {done ? (
        <View style={styles.doneWrap}>
          <View style={[styles.doneBadge, curve, { backgroundColor: c.openBg }]}>
            <Icon name="check" size={24} color={c.open} />
          </View>
          <Txt variant="title">Got it</Txt>
          <Txt variant="body" muted style={{ textAlign: 'center' }}>
            We'll check it and post it shortly.
          </Txt>
        </View>
      ) : (
        <View style={{ padding: space.lg, gap: space.lg, flex: 1 }}>
          {photoUri ? (
            <View style={[styles.photoWrap, curve, { backgroundColor: c.surfaceAlt }]}>
              <Image source={{ uri: photoUri }} style={{ width: photoW, height: photoW * 0.75 }} contentFit="cover" />
              <Tap
                onPress={() => setPhotoUri(null)}
                haptic="light"
                style={[styles.retake, { backgroundColor: c.surface }]}
                accessibilityLabel="Remove photo"
              >
                <Icon name="x" size={15} color={c.textHeading} />
              </Tap>
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <View style={styles.pickRow}>
                <Button label="Camera" icon="camera" onPress={() => { pick(true); }} flex />
                <Button label="Gallery" icon="image" variant="tonal" onPress={() => { pick(false); }} flex />
              </View>
              {err ? (
                <View style={[styles.gateNote, curve, { backgroundColor: c.closedBg }]}>
                  <Icon name="alert-circle" size={15} color={c.closed} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyMed" color={c.closed}>{err.title}</Txt>
                    <Txt variant="caption" muted>{err.body}</Txt>
                  </View>
                </View>
              ) : (
                <Txt variant="caption" faint style={{ textAlign: 'center' }}>
                  Photos of the place only — no people. Checked before posting.
                </Txt>
              )}
            </View>
          )}

          {photoUri ? (
            <>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Anything worth knowing? (optional)"
                placeholderTextColor={c.textFaint}
                maxLength={280}
                multiline
                style={[styles.caption, curve, {
                  backgroundColor: c.surface, borderColor: c.border, color: c.text,
                }]}
              />
              <Button
                label={busy ? 'Posting…' : 'Post'}
                icon="send"
                onPress={() => { if (!busy) submit(); }}
              />
            </>
          ) : null}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', gap: space.sm },
  photoWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  retake: {
    position: 'absolute', top: 8, right: 8, width: 30, height: 30,
    borderRadius: 15, alignItems: 'center', justifyContent: 'center',
  },
  gateNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
  caption: {
    minHeight: 80, borderWidth: 1, borderRadius: radius.md,
    padding: space.md, fontSize: 15, textAlignVertical: 'top',
  },
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  doneBadge: {
    width: 64, height: 64, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
});
