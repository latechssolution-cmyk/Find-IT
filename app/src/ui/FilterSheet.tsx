/**
 * Needs filters, behind one affordance.
 *
 * These used to be a second scrolling chip row. On a 375 px phone that row —
 * stacked under the search bar, the location pills and the category chips —
 * pushed the map (the actual product) below the fold. Filters are a
 * considered action, not a browsing gesture: people reach for "delivery" when
 * they already know they want it, so one tap to open a list is cheaper than a
 * permanent row that costs every user vertical space forever.
 *
 * "Open now" deliberately does NOT live here — it's the single most common
 * need, and burying it is the classic way to lose it.
 */

import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, curve, radius, shadow, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';

export interface NeedOption {
  key: string;
  label: string;
  icon: IconName;
  /** Why it matters — sets expectations before the result count moves. */
  hint?: string;
}

export function FilterSheet({
  visible, options, selected, onToggle, onClear, onClose, resultCount,
}: {
  visible: boolean;
  options: NeedOption[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
  resultCount?: number;
}) {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();

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

          <View style={styles.head}>
            <Txt variant="title">Filters</Txt>
            {selected.length ? (
              <Tap onPress={onClear} haptic="selection">
                <Txt variant="label" color={c.accentText}>Clear all</Txt>
              </Tap>
            ) : null}
          </View>

          <ScrollView style={{ maxHeight: 380 }}>
            {options.map((o) => {
              const on = selected.includes(o.key);
              return (
                <Tap
                  key={o.key}
                  onPress={() => onToggle(o.key)}
                  haptic="light"
                  scaleTo={0.99}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.row, { borderBottomColor: c.border }]}
                >
                  <Icon name={o.icon} size={17} color={on ? c.accentText : c.textMuted} muted={!on} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="body">{o.label}</Txt>
                    {o.hint ? <Txt variant="caption" muted>{o.hint}</Txt> : null}
                  </View>
                  {/* Checkbox, not a switch: switches imply an immediate
                      side effect, and these compose into one query. */}
                  <View
                    style={[
                      styles.box, curve,
                      on
                        ? { backgroundColor: c.brand, borderColor: c.brand }
                        : { borderColor: c.border },
                    ]}
                  >
                    {on ? <Icon name="check" size={13} color={c.onBrand} /> : null}
                  </View>
                </Tap>
              );
            })}
          </ScrollView>

          <Tap
            onPress={onClose}
            haptic="light"
            scaleTo={0.98}
            style={[styles.cta, curve, { backgroundColor: c.brand }]}
          >
            <Txt variant="label" color={c.onBrand}>
              {resultCount != null ? `Show ${resultCount} places` : 'Done'}
            </Txt>
          </Tap>
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
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: space.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52,
  },
  box: {
    width: 22, height: 22, borderRadius: radius.xs, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  cta: {
    marginTop: space.md, paddingVertical: 14, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
});
