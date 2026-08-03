/**
 * Shared UI primitives. Every one is theme-aware and font-scale resilient
 * (PRD §6.4: chips wrap rather than truncate, no hard-coded row heights).
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';

import { colors, curve, motion, radius, shadow, space, type as typo, type Scheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { useScheme } from './useScheme';

/* ------------------------------------------------------------------ Pressable
   Every tappable surface uses this: consistent press physics + haptics.
   "Good haptics are felt, not noticed" — always paired with a visual change. */

export interface TapProps extends PressableProps {
  haptic?: 'selection' | 'light' | 'medium' | 'success' | 'none';
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Tap({ haptic = 'selection', scaleTo = 0.97, style, onPressIn, onPress, children, ...rest }: TapProps) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  // Press physics are ASYMMETRIC on purpose: down is a fast timing so the
  // response feels instant, up is a spring so the release feels like material.
  // Symmetric timing on both sides is one of the most common cheap tells.
  const handleIn = useCallback((e: any) => {
    s.value = withTiming(scaleTo, { duration: motion.pressDownMs });
    onPressIn?.(e);
  }, [onPressIn, s, scaleTo]);

  const handleOut = useCallback(() => { s.value = withSpring(1, motion.press); }, [s]);

  const handlePress = useCallback((e: any) => {
    if (haptic !== 'none') {
      const map = {
        selection: () => Haptics.selectionAsync(),
        light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      } as const;
      map[haptic]?.();
    }
    onPress?.(e);
  }, [haptic, onPress]);

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handleIn}
      onPressOut={handleOut}
      onPress={handlePress}
      style={[anim, style as any]}
    >
      {children as any}
    </AnimatedPressable>
  );
}

/* ---------------------------------------------------------------------- Text */

type Variant = keyof typeof typo;

export function Txt({
  variant = 'body', muted, faint, color, style, children, numberOfLines, onLayout,
}: {
  variant?: Variant; muted?: boolean; faint?: boolean; color?: string;
  style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number;
  /** ClampText measures height through this — onTextLayout is native-only. */
  onLayout?: TextProps['onLayout'];
}) {
  const sch = useScheme();
  const c = colors(sch);
  return (
    <Text
      numberOfLines={numberOfLines}
      onLayout={onLayout}
      style={[
        typo[variant],
        { color: color ?? (faint ? c.textFaint : muted ? c.textMuted : c.text) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* --------------------------------------------------------------------- Chip */

export function Chip({
  label, icon, active, onPress, tint,
}: {
  label: string; icon?: IconName; active?: boolean; onPress?: () => void; tint?: string;
}) {
  const sch = useScheme();
  const c = colors(sch);
  // Active chips use the BRAND, not a per-category rainbow: a dozen coloured
  // pills is the classic discovery-app toy signal. Category colour survives as
  // a small tint on the icon only.
  const activeBg = c.brand;
  const fg = active ? c.onBrand : c.text;
  return (
    <Tap
      onPress={onPress}
      haptic="selection"
      scaleTo={0.95}
      style={[
        styles.chip,
        curve,
        {
          backgroundColor: active ? activeBg : c.surface,
          borderColor: active ? activeBg : c.border,
        },
      ]}
    >
      {icon ? (
        <Icon name={icon} size={14} color={active ? c.onBrand : (tint ?? c.textMuted)} muted={!active} />
      ) : null}
      <Text style={[typo.label, { color: fg }]}>{label}</Text>
    </Tap>
  );
}

/* -------------------------------------------------------------------- Rating */

export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  const sch = useScheme();
  const c = colors(sch);
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Text key={i} style={{ fontSize: size, color: i < full || (i === full && half) ? c.star : c.textFaint }}>
          {i < full ? '★' : i === full && half ? '⯨' : '☆'}
        </Text>
      ))}
    </View>
  );
}

/** Rating chip — the single most-read datum on a card, so it gets a tinted
 *  pill rather than loose text. */
export function RatingPill({ value, count, size = 'sm' }: { value: number; count?: number | null; size?: 'sm' | 'lg' }) {
  const sch = useScheme();
  const c = colors(sch);
  return (
    <View style={[styles.ratingPill, { backgroundColor: c.accentWash }]}>
      <Text style={{ fontSize: size === 'lg' ? 13 : 11, color: c.star }}>★</Text>
      <Text style={[size === 'lg' ? typo.bodyMed : typo.label, { color: c.textHeading }]}>
        {value.toFixed(1)}
      </Text>
      {count ? (
        <Text style={[typo.caption, { color: c.textMuted }]}>
          {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
        </Text>
      ) : null}
    </View>
  );
}

/** Open / Closes soon / Closed. A dot plus TEXT — never colour alone, since
 *  open/closed sits exactly on the red-green axis. */
export function OpenState({ open, compact }: { open: boolean | null; compact?: boolean }) {
  const sch = useScheme();
  const c = colors(sch);
  if (open === null) return <Txt variant="caption" faint>Hours unknown</Txt>;
  const tone = open ? c.open : c.closed;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone }} />
      <Text style={[typo.caption, { color: tone }]}>
        {open ? (compact ? 'Open' : 'Open now') : 'Closed'}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ Skeleton
   Mirrors the real card layout so content crossfades in instead of popping. */

export function Skeleton({ w, h, r = radius.sm, style }: { w?: number | string; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const sch = useScheme();
  const c = colors(sch);
  const o = useSharedValue(0.5);
  React.useEffect(() => {
    o.value = withTiming(1, { duration: 900 });
    const id = setInterval(() => { o.value = withTiming(o.value > 0.7 ? 0.45 : 1, { duration: 900 }); }, 900);
    return () => clearInterval(id);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: w as any, height: h, borderRadius: r, backgroundColor: c.surfaceAlt }, anim, style]} />;
}

export function PlaceCardSkeleton() {
  return (
    <View style={styles.skelCard}>
      <Skeleton w={84} h={84} r={radius.md} />
      <View style={{ flex: 1, gap: space.sm, paddingVertical: space.xs }}>
        <Skeleton w="70%" h={16} />
        <Skeleton w="45%" h={12} />
        <Skeleton w="55%" h={12} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------- Empty states */

export function EmptyState({
  icon, title, body, action,
}: { icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
  const sch = useScheme();
  const c = colors(sch);
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyBadge, curve, { backgroundColor: c.surfaceAlt }]}>
        <Icon name={icon} size={26} color={c.textMuted} />
      </View>
      <Txt variant="title" style={{ textAlign: 'center' }}>{title}</Txt>
      {body ? (
        <Txt variant="body" muted style={{ textAlign: 'center', maxWidth: 300 }}>{body}</Txt>
      ) : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function Spinner() {
  const c = colors(useScheme());
  return <ActivityIndicator color={c.accent} />;
}

/* ------------------------------------------------------------------- Button */

export function Button({
  label, icon, onPress, variant = 'primary', flex,
}: {
  label: string; icon?: IconName; onPress?: () => void;
  variant?: 'primary' | 'tonal' | 'ghost'; flex?: boolean;
}) {
  const sch = useScheme();
  const c = colors(sch);
  const bg = variant === 'primary' ? c.brand : variant === 'tonal' ? c.accentWash : 'transparent';
  const fg = variant === 'primary' ? c.onBrand : variant === 'tonal' ? c.textHeading : c.textMuted;
  return (
    <Tap
      onPress={onPress}
      haptic="light"
      scaleTo={0.96}
      style={[
        styles.btn,
        curve,
        { backgroundColor: bg, flex: flex ? 1 : undefined,
          borderWidth: variant === 'ghost' ? 1 : 0, borderColor: c.border },
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={fg} muted={variant !== 'primary'} /> : null}
      <Text style={[typo.label, { color: fg }]}>{label}</Text>
    </Tap>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const sch = useScheme();
  const c = colors(sch);
  const body = (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, shadow(sch, 1), style]}>
      {children}
    </View>
  );
  return onPress ? <Tap onPress={onPress} haptic="light">{body}</Tap> : body;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radius.pill, borderWidth: 1,
  },
  chipIcon: { fontSize: 14 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingHorizontal: space.xl, paddingVertical: 14, borderRadius: radius.md,
    minHeight: 50,
  },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  skelCard: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 },
  empty: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.xxl },
  emptyBadge: {
    width: 60, height: 60, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.xs,
  },
});
