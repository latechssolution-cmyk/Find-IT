/**
 * "Busy now" — hourly busy-ness for a place.
 *
 * This is the one place we match Google on a feature the local competition
 * doesn't have at all, using data we already scraped. It answers a question
 * people genuinely ask before leaving the house ("is it packed right now?")
 * and it is the single most-cited reason to open a place card before going.
 *
 * Design notes:
 *  - The headline is a SENTENCE, not a chart. Most people want the answer,
 *    not the data; the bars are there for the minority who want to plan.
 *  - Current hour is highlighted, and the chart starts at 6am rather than
 *    midnight — twelve dead bars before opening is noise, not information.
 *  - Bars are relative to the day's own peak, so a quiet café and a packed
 *    mall are both readable rather than one being a flat line.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, curve, radius, space } from '../theme';
import { Icon } from './Icon';
import { Tap, Txt } from './primitives';
import { useScheme } from './useScheme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const START_HOUR = 6;   // nobody needs to see 12 empty bars before dawn
const END_HOUR = 24;

function label(pct: number): string {
  if (pct >= 80) return 'As busy as it gets';
  if (pct >= 60) return 'Busier than usual';
  if (pct >= 35) return 'Steady';
  if (pct > 0) return 'Not busy';
  return 'Usually quiet';
}

export function PopularTimes({ data }: { data: number[][] }) {
  const sch = useScheme();
  const c = colors(sch);
  const today = new Date().getDay();
  const hour = new Date().getHours();
  const [day, setDay] = useState(today);

  const series = data[day] ?? [];
  const peak = useMemo(() => Math.max(1, ...series), [series]);
  const nowPct = data[today]?.[hour] ?? 0;
  const isToday = day === today;

  // A place with no data for the whole week shouldn't render an empty chart.
  if (!series.some((v) => v > 0)) return null;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.head}>
        <Txt variant="overline" muted>POPULAR TIMES</Txt>
        {isToday && nowPct > 0 ? (
          <View style={[styles.nowPill, curve, { backgroundColor: c.accentWash }]}>
            <Icon name="activity" size={12} color={c.accentText} />
            <Txt variant="caption" color={c.accentText}>{label(nowPct)}</Txt>
          </View>
        ) : null}
      </View>

      {/* day selector */}
      <View style={styles.dayRow}>
        {DAYS.map((d, i) => {
          const active = i === day;
          return (
            <Tap
              key={d}
              onPress={() => setDay(i)}
              haptic="selection"
              scaleTo={0.92}
              accessibilityLabel={`Show ${d}`}
              accessibilityState={{ selected: active }}
              style={[
                styles.dayBtn, curve,
                active && { backgroundColor: c.brand },
              ]}
            >
              <Txt variant="caption" color={active ? c.onBrand : c.textMuted}>
                {d[0]}
              </Txt>
            </Tap>
          );
        })}
      </View>

      {/* bars */}
      <View style={styles.chart} accessibilityLabel={`Busy-ness by hour for ${DAYS[day]}`}>
        {series.slice(START_HOUR, END_HOUR).map((v, i) => {
          const h = START_HOUR + i;
          const isNow = isToday && h === hour;
          const height = Math.max(3, Math.round((v / peak) * 56));
          return (
            <View key={h} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  {
                    height,
                    backgroundColor: isNow ? c.accent : v > 0 ? c.surfaceAlt : 'transparent',
                    borderWidth: isNow ? 0 : StyleSheet.hairlineWidth,
                    borderColor: c.border,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* sparse axis — 6a / noon / 6p / midnight is enough to orient */}
      <View style={styles.axis}>
        {['6a', '12p', '6p', '12a'].map((t) => (
          <Txt key={t} variant="caption" faint>{t}</Txt>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  nowPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.xs,
  },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayBtn: {
    width: 30, height: 30, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 2 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.sm },
});
