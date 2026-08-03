/**
 * "Suggest an edit" — the correction path for scraped data.
 *
 * One tap to open, one tap to report. No account, no form, no free-text
 * requirement: every field beyond the reason itself reduces the number of
 * corrections we get, and corrections are the whole point.
 */

import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { colors, curve, radius, shadow, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';
import { REPORT_LABELS, useReportStore, type ReportKind } from '../hooks/useReports';

export function ReportSheet({
  visible, placeId, placeName, onClose,
}: { visible: boolean; placeId: string; placeName: string; onClose: () => void }) {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const reports = useReportStore();
  const [done, setDone] = useState<ReportKind | null>(null);

  const submit = async (kind: ReportKind) => {
    await reports.submit(placeId, kind);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(kind);
    setTimeout(() => { setDone(null); onClose(); }, 1300);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: c.scrim }]}>
        <Tap onPress={onClose} haptic="none" style={StyleSheet.absoluteFill}>
          <View />
        </Tap>

        <View
          style={[
            styles.sheet, curve,
            { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + space.lg },
            shadow(sch, 3),
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          {done ? (
            <View style={styles.doneWrap}>
              <View style={[styles.doneBadge, curve, { backgroundColor: c.openBg }]}>
                <Icon name="check" size={24} color={c.open} />
              </View>
              <Txt variant="title">Thanks — noted</Txt>
              <Txt variant="body" muted style={{ textAlign: 'center' }}>
                We'll check this and update the listing.
              </Txt>
            </View>
          ) : (
            <>
              <View style={{ gap: 3, paddingBottom: space.sm }}>
                <Txt variant="title">Suggest an edit</Txt>
                <Txt variant="body" muted numberOfLines={1}>{placeName}</Txt>
              </View>

              <ScrollView style={{ maxHeight: 380 }}>
                {REPORT_LABELS.map(({ kind, label, icon }) => (
                  <Tap
                    key={kind}
                    onPress={() => submit(kind)}
                    haptic="light"
                    scaleTo={0.99}
                    accessibilityRole="button"
                    style={[styles.row, { borderBottomColor: c.border }]}
                  >
                    <Icon name={icon as IconName} size={17} color={c.textMuted} muted />
                    <Txt variant="body" style={{ flex: 1 }}>{label}</Txt>
                    <Icon name="chevron-right" size={15} color={c.textFaint} muted />
                  </Tap>
                ))}
              </ScrollView>

              <Txt variant="caption" faint style={{ textAlign: 'center', paddingTop: space.md }}>
                Reports are anonymous and help everyone here.
              </Txt>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderWidth: 1, paddingHorizontal: space.lg, paddingTop: space.sm,
  },
  grabber: {
    width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: space.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52,
  },
  doneWrap: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  doneBadge: {
    width: 60, height: 60, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
});
