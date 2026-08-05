/**
 * Is it Ramadan right now?
 *
 * During Ramadan most food places in Pakistan invert their day — closed
 * through the fast, then open from iftar deep into the night — and Google's
 * scraped hours describe the other eleven months. We can't know each place's
 * Ramadan hours, and pretending we do is worse than saying "hours shift this
 * month". So the app's job is a clearly-worded caveat, not fake precision.
 *
 * Detection uses the Umm al-Qura calendar via Intl, which both Hermes (RN)
 * and browsers ship. Any failure means "not Ramadan": a missed banner for one
 * month is better than a crash or a false banner all year.
 */

const RAMADAN = 9;   // ninth month of the Islamic calendar

export function isRamadan(now: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric' })
      .formatToParts(now);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    return m === RAMADAN;
  } catch {
    return false;
  }
}

/**
 * Jummah — same honesty rule, every week.
 *
 * Most shops, banks and services pause roughly 1:00–2:30pm on Friday for
 * congregational prayer, and scraped hours almost never encode it: "Open
 * now" is simply wrong across that window, weekly, for most of the
 * directory. Per-place times are unknowable (they follow the local mosque),
 * so — exactly like Ramadan — the app's job is a caveat, not fake precision.
 *
 * The window is deliberately generous (11:30–14:30 visible): someone
 * planning a 1pm errand at 11:45 is precisely who the note is for.
 */
export function isJummahWindow(now: Date = new Date()): boolean {
  if (now.getDay() !== 5) return false;               // Friday only
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 11 * 60 + 30 && mins <= 14 * 60 + 30;
}

/** Buckets where a Jummah pause is the norm rather than the exception.
 *  Food largely stays open (it feeds the post-prayer rush), lodging never
 *  closes, entertainment venues vary too much to claim. */
const JUMMAH_BUCKETS = new Set([
  'shopping', 'services', 'health', 'beauty', 'automotive', 'finance', 'education',
]);

export function jummahLikely(bucket?: string | null): boolean {
  return JUMMAH_BUCKETS.has(bucket ?? '');
}
