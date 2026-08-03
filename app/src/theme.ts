/**
 * FIND IT design tokens — "chocolate & cream".
 *
 * Every value here was generated in OKLCH and gamut-mapped to sRGB, and every
 * foreground/background pair was contrast-checked (ratios noted inline). Three
 * rules govern the ramps:
 *
 *   1. ARCH THE CHROMA. Muddy brown is not "too much brown", it's adequate
 *      chroma at the ends and too little in the middle. Chroma peaks ~0.096 at
 *      L60 and falls to ~0.009 at the light end, ~0.038 at the dark end.
 *   2. ROTATE HUE WITH LIGHTNESS. Lights 82° (oat, not pink), midtones 47–58°
 *      (cognac, not khaki), darks 38–40° (espresso, not cool grey-brown).
 *   3. CREAM CARRIES 4.5x LESS CHROMA THAN CHOCOLATE. If the neutrals carry
 *      chocolate-level chroma the whole UI turns orange.
 *
 * The trap to remember: on cream, chocolate is legal as text only at L <= 51%.
 * The most attractive browns (L 60–68%) are exactly the ones that fail AA.
 */

/* ------------------------------------------------------------------ ramps */

export const choc = {
  50:   '#F9F6F0',
  100:  '#F5EDE0',
  200:  '#EDDBC6',
  300:  '#E4C5A8',
  400:  '#D6A886',
  500:  '#C58A66',   // decorative only — 2.77:1 on cream, fails even 3:1
  600:  '#AD6C4B',   // 3.97:1 — large text / UI only
  700:  '#925236',   // 5.73:1 — lightest brown legal as body text
  800:  '#763D26',   // 8.09:1 — primary brand
  900:  '#5A2B1A',   // 11.12:1 — headings
  950:  '#3C1B10',   // 14.71:1
  1000: '#220D07',   // 17.68:1 — max ink; also the shadow tint
} as const;

export const cream = {
  50:   '#FEFDFA',   // card on tinted bg
  100:  '#FBF9F4',   // page background (light)
  200:  '#F7F3EC',
  300:  '#F2ECE2',
  400:  '#EAE3D7',   // hover
  500:  '#DFD6C9',   // pressed
  600:  '#CCC3B5',   // hairline divider
  700:  '#B0A69A',   // decorative border only (2.28:1)
  800:  '#8F847A',   // interactive border (3.47:1 — passes 1.4.11)
  900:  '#685E56',   // secondary text (6.00:1)
  950:  '#443B36',
  1000: '#241E1B',
} as const;

/** Dark surfaces. Chroma RISES with lightness (0.011 -> 0.018) while hue FALLS
 *  (52 -> 48): constant chroma up the stack makes upper surfaces look dirty. */
const night = {
  base: '#110C09',
  s1:   '#19120E',
  s2:   '#211915',
  s3:   '#2A211C',
  s4:   '#342A25',
  borderSubtle: '#3D312C',
  border:        '#4C3F39',
  borderStrong:  '#75655D',   // 3.50:1 — passes 1.4.11
} as const;

export type Scheme = 'light' | 'dark';

export const colors = (s: Scheme) =>
  s === 'light'
    ? {
        bg: cream[100],
        bgSunken: cream[200],
        surface: cream[50],
        surfaceAlt: cream[300],
        surfaceHover: cream[400],
        surfacePress: cream[500],

        border: cream[600],
        borderStrong: cream[800],

        text: choc[1000],           // 17.68:1
        textHeading: choc[900],     // 11.12:1
        textMuted: cream[900],      // 6.00:1  — neutral, not brown: a brown
                                    // secondary competes with primary text
        textFaint: cream[800],      // 3.47:1  — UI/large only, never body
        onDark: cream[50],

        brand: choc[800],           // cream-50 on it = 8.37:1
        brandHover: '#65321E',
        brandPress: '#532718',
        onBrand: cream[50],

        accent: '#E3932F',          // caramel — fills, stars, active states
        accentText: '#C07525',      // 3.43:1 — large/UI only
        accentWash: 'rgba(227, 147, 47, 0.12)',
        onAccent: choc[1000],       // 7.51:1 on caramel

        open: '#2C6D3E',            // 5.93:1 — quiet, not neon
        openBg: '#E1F5E4',
        soon: '#9F6713',            // 4.51:1
        soonBg: '#FDEFD2',
        closed: '#9C3024',          // 6.11:1 — terracotta-red, hue 30, only
                                    // 12° from brand so it never looks bolted on
        closedBg: '#FFE7E1',
        info: '#2E707F',            // 5.34:1
        star: '#C07525',

        focus: '#9A5328',           // 5.48:1
        scrim: 'rgba(34, 13, 7, 0.55)',
      }
    : {
        bg: night.base,
        bgSunken: '#0C0806',
        surface: night.s1,
        surfaceAlt: night.s2,
        surfaceHover: night.s2,
        surfacePress: night.s3,

        border: night.borderSubtle,
        borderStrong: night.borderStrong,

        text: '#F2ECE2',            // 16.54:1 — oat, NOT pure white: white on a
                                    // 15.8% base sits above the halation
                                    // threshold and blurs for low-vision readers
        textHeading: '#F2ECE2',
        textMuted: '#B9B0A3',       // 9.07:1
        textFaint: '#968C81',       // 5.89:1
        onDark: choc[1000],

        // Chocolate has NO dark-mode foreground form (choc-800 is 1.55:1 on the
        // dark base), so the accent carries brand identity here.
        brand: '#E3932F',
        brandHover: '#EEAC53',
        brandPress: '#C07525',
        onBrand: choc[1000],

        accent: '#EEAC53',
        accentText: '#EEAC53',
        accentWash: 'rgba(238, 172, 83, 0.14)',
        onAccent: choc[1000],

        open: '#89CD9B',            // 10.43:1
        openBg: '#17291B',
        soon: '#F3C264',
        soonBg: '#332310',
        closed: '#EE8773',          // 7.73:1
        closedBg: '#371D19',
        info: '#88C7D0',
        star: '#F3C264',

        focus: '#E7A968',           // 9.51:1
        scrim: 'rgba(0, 0, 0, 0.62)',
      };

/* ----------------------------------------------------------------- spacing */

export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = {
  xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 28, pill: 999,
} as const;

/* -------------------------------------------------------------- typography */

/**
 * Two families, the Resy split: an editorial SERIF carries place identity,
 * a neutral SANS carries the interface. Shipping neither Inter nor Roboto is
 * itself the signal — those now read as "nobody chose this".
 *
 *   Instrument Serif — display only. 400 + italic, NO bold exists, so it must
 *                      never be asked for emphasis (synthetic bold on a
 *                      high-contrast serif looks broken on Android).
 *   Geist            — the whole UI. 165 KB variable, 100–900.
 *
 * Optical rules: tracking INVERTS with size — negative above ~20px (large type
 * looks loose otherwise), positive below 13px and on anything uppercase.
 * Every style carries an explicit lineHeight because Urdu Nastaliq needs
 * ~1.5–2x and layout must never depend on a fixed row height.
 */
export const font = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  sans: 'Geist_400Regular',
  sansMed: 'Geist_500Medium',
  sansSemi: 'Geist_600SemiBold',
  sansBold: 'Geist_700Bold',
} as const;

export const type = {
  /** Serif display — place names, hero headlines. Leading is TIGHTER than the
   *  size at this scale; 1.5 line-height on a 34px headline is what makes
   *  mobile display type look amateur. */
  hero:    { fontFamily: font.serif, fontSize: 36, lineHeight: 40, letterSpacing: -0.4 },
  display: { fontFamily: font.serif, fontSize: 30, lineHeight: 34, letterSpacing: -0.3 },
  serifLg: { fontFamily: font.serif, fontSize: 24, lineHeight: 29, letterSpacing: -0.2 },

  title:   { fontFamily: font.sansBold, fontSize: 21, lineHeight: 27, letterSpacing: -0.4 },
  heading: { fontFamily: font.sansSemi, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  body:    { fontFamily: font.sans,     fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyMed: { fontFamily: font.sansMed,  fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  label:   { fontFamily: font.sansMed,  fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: font.sans,     fontSize: 12, lineHeight: 17, letterSpacing: 0.1 },
  overline:{ fontFamily: font.sansSemi, fontSize: 11, lineHeight: 14, letterSpacing: 0.9 },
} as const;

/* ------------------------------------------------------------------ motion */

/**
 * Closed vocabulary. If an interaction isn't here, it doesn't animate.
 *
 * Two spring families, borrowed from Material 3's motion architecture:
 *   SPATIAL springs (position, size, scale) may overshoot slightly.
 *   EFFECTS springs (opacity, colour) NEVER overshoot — a bouncing fade is
 *   one of the clearest amateur tells.
 *
 * Damping ratio = damping / (2·sqrt(stiffness·mass)). Everything here sits at
 * 0.8–1.0, which is the premium band; Reanimated's own doc-example spring
 * (damping 10 / stiffness 100) is ratio 0.5 and reads like a toy.
 */
export const motion = {
  /** ratio 0.87 — the default for anything the user taps. */
  spatial: { damping: 26, stiffness: 300, mass: 1 },
  /** ratio 1.15, slightly overdamped: large surfaces must not bounce. */
  sheet:   { damping: 34, stiffness: 220, mass: 1 },
  /** Release only. Press-DOWN is a fast timing, not a spring (see Tap). */
  press:   { damping: 20, stiffness: 500, mass: 0.7 },
  pressDownMs: 90,
  /** ratio 0.93 — shared-element card → detail. */
  shared:  { damping: 30, stiffness: 250, mass: 1 },
  pinLift: 150,
  /** The one place a little bounce is right: a pin landing has weight. */
  pinDrop: { damping: 14, stiffness: 340, mass: 0.8 },
  fade:    200,
  /** Per item, capped at ~8 items — beyond that the tail feels broken. */
  stagger: 30,
  staggerMax: 8,
} as const;

/* ------------------------------------------------------------------ depth */

/**
 * Light mode: TINTED shadows. A pure-black shadow over a warm ground reads
 * grey and synthetic. Alpha stays <= 0.10 because warm shadows read heavier
 * than neutral ones at equal alpha. Two layers (a tight contact shadow plus a
 * wide ambient one) is what separates "designed" from "drop-shadow".
 *
 * Dark mode: NO shadows. They're invisible on a 15.8%-lightness base and only
 * muddy the surface — elevation comes from the surface lightness ladder.
 */
export const shadow = (s: Scheme, level: 1 | 2 | 3 = 1) => {
  if (s === 'dark') return {};
  // blur ≈ 2x the y-offset (real light falls off that way), alpha kept low:
  // if you can consciously see the shadow, it is already too strong.
  const spec = [
    { o: 0.05, r: 3,  y: 1,  e: 1 },
    { o: 0.07, r: 10, y: 5,  e: 4 },
    { o: 0.10, r: 26, y: 13, e: 10 },
  ][level - 1];
  return {
    shadowColor: choc[1000],
    shadowOpacity: spec.o,
    shadowRadius: spec.r,
    shadowOffset: { width: 0, height: spec.y },
    elevation: spec.e,
  };
};

/**
 * Concentric radii: inner = outer − padding. A 16px card with 12px padding
 * must hold a 4px child. Equal inner and outer radii produce a visible
 * crescent of uneven stroke at the corner that people feel but can't name.
 */
export const innerRadius = (outer: number, padding: number) =>
  Math.max(2, outer - padding);

/** iOS squircles. Ignored on Android, so it's safe to spread everywhere. */
export const curve = { borderCurve: 'continuous' as const };

/** Scrim for text over photography — choc-1000, not black, so the fade stays
 *  warm and cream text on it still clears AA. */
export const photoScrim = 'rgba(34, 13, 7, 0.78)';

/* -------------------------------------------------------------- categories */

/** Tints are drawn from the warm family so chips never look like a rainbow
 *  pasted onto the palette. Keep in sync with pipeline/conform.py. */
export const categoryMeta: Record<string, { icon: string; tint: string; label: string }> = {
  food_drink:    { icon: '🍽️', tint: '#C4493A', label: 'Food & Drink' },
  shopping:      { icon: '🛍️', tint: '#8C5A9E', label: 'Shopping' },
  health:        { icon: '⚕️',  tint: '#317A45', label: 'Health' },
  beauty:        { icon: '💇',  tint: '#B5576B', label: 'Beauty' },
  education:     { icon: '🎓',  tint: '#2E707F', label: 'Education' },
  services:      { icon: '🔧',  tint: '#8A6A34', label: 'Services' },
  entertainment: { icon: '🎬',  tint: '#7A5AA8', label: 'Entertainment' },
  automotive:    { icon: '🚗',  tint: '#3F6B93', label: 'Automotive' },
  finance:       { icon: '🏦',  tint: '#2C6D5A', label: 'Finance' },
  lodging:       { icon: '🏨',  tint: '#A6556E', label: 'Hotels' },
  other:         { icon: '📍',  tint: '#8F847A', label: 'More' },
};
