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
