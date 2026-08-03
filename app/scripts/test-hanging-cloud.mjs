/**
 * Does a HANGING cloud call degrade to the bundle, or freeze the app?
 *
 * Distinct from the offline test: there the network is severed and requests
 * fail. Here Supabase requests are black-holed — accepted and never answered
 * — which is the nastier and more common real-world case on a saturated
 * mobile network. Without a deadline the fallback never runs, because the
 * fallback is in a .catch that nothing ever triggers.
 *
 *   node scripts/test-hanging-cloud.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:/Users/HP/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright',
);

const BASE = 'http://localhost:8081';

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 540, height: 1170 } });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('findit.onboarded.v1', '1'));

  // Black-hole every Supabase call: never respond, never fail.
  let held = 0;
  await ctx.route('**/*.supabase.co/**', async () => { held++; /* never fulfilled */ });

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  let elapsed = null;
  for (let i = 0; i < 80; i++) {
    const ok = await page.evaluate(() =>
      /\d+ places? nearby/.test(document.body.innerText || ''));
    if (ok) { elapsed = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }

  const text = await page.evaluate(() => document.body.innerText || '');
  const count = (/(\d+) places? nearby/.exec(text) || [])[1];

  console.log(`held ${held} supabase requests open (never answered)`);
  if (elapsed == null) {
    console.log('FAIL  app never rendered results — a hanging cloud call freezes it');
    process.exit(1);
  }
  console.log(`PASS  fell back to the bundle in ${elapsed} ms — ${count} places`);
  await browser.close();
};

run().catch((e) => { console.error(e.message); process.exit(1); });
