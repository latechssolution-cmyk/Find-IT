/**
 * Play Store phone screenshots, captured from the running app.
 *
 * 1080x2340 — the standard Android phone frame Google expects. Driven at
 * 540x1170 CSS with deviceScaleFactor 2 so text renders at true retina
 * density rather than being upscaled from a smaller grab, which is the
 * usual reason store screenshots look soft.
 *
 * These come from the real React Native code via react-native-web, so
 * layout, type and colour are the product's own. Native builds differ in
 * small ways (map tile rendering, system font fallback for Urdu), so treat
 * these as a strong starting set and re-shoot on a device before a final
 * submission if anything looks off.
 *
 * Requires the dev server on :8081.
 *
 *   node scripts/capture-screenshots.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright lives in the global npm tree (installed for the taste skill),
// not in this project. An absolute Windows path is not a legal ESM specifier
// — hence createRequire rather than a bare import.
const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/HP/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright',
);

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'store-assets');
const BASE = 'http://localhost:8081';

/** Settle time per screen — the map and remote thumbnails need a beat. */
const SETTLE = 11_000;

const SHOTS = [
  { file: '1-explore.png', path: '/', wait: SETTLE + 6000 },
  { file: '2-place.png', path: '/place/7dd7e178-9949-46e8-a70f-aaef52a4de0f', wait: SETTLE },
  // "pizza" rather than "biryani": both are honest, but biryani's long tail
  // in Faisalabad is mostly unenriched listings, so that screen reads as
  // sparse — an inaccurate impression of a 100k-place database. Choosing a
  // representative query is fair; faking results would not be.
  { file: '3-search.png', path: '/search', wait: 7000, type: 'pizza' },
  { file: '4-location.png', path: '/location', wait: SETTLE },
];

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 540, height: 1170 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();

  // Skip onboarding so shots show the product, not the primer.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('findit.onboarded.v1', '1');
    localStorage.setItem('findit.theme.v1', 'light');
  });

  for (const shot of SHOTS) {
    await page.goto(BASE + shot.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(shot.wait);

    if (shot.type) {
      const input = page.locator('input').first();
      await input.fill(shot.type);
      await page.waitForTimeout(900);
      await input.press('Enter');
      await page.waitForTimeout(6000);
    }

    await page.screenshot({ path: join(OUT, shot.file) });
    console.log(`  ${shot.file}`);
  }

  await browser.close();
  console.log(`\nwrote ${SHOTS.length} screenshots to store-assets/ at 1080x2340`);
};

run().catch((e) => {
  console.error('capture failed:', e.message);
  process.exit(1);
});
