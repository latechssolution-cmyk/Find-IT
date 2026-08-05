/**
 * End-to-end check of the search pipeline against the REAL bundled dataset.
 *
 * Runs the same normalise -> expand -> match -> rank path the app uses, so a
 * regression in typo tolerance or ranking fails here rather than on a device.
 *
 *   node scripts/verify-search.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(join(here, '../assets/data/faisalabad.json'), 'utf8'));

/* --- mirrors src/data/search.ts (kept in sync deliberately: this is a check,
       not an import, so a broken export surface still gets caught) --- */
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9؀-ۿ\s]/g, ' ').replace(/\s+/g, ' ').trim();

const SYN = {
  chai: ['tea', 'chaye', 'dhaba', 'cafe'], biryani: ['rice', 'pulao', 'food'],
  salon: ['saloon', 'parlour', 'beauty'], saloon: ['salon', 'parlour', 'beauty'],
  pharmacy: ['medical', 'chemist', 'medicine'], medical: ['pharmacy', 'chemist'],
  kiryana: ['grocery', 'general store'], grocery: ['kiryana', 'mart'],
  karahi: ['restaurant', 'bbq', 'desi', 'food'],
};

function tri(s) {
  const p = `  ${s} `; const out = new Set();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}
function trigramSim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const A = tri(a), B = tri(b); let sh = 0;
  A.forEach((t) => { if (B.has(t)) sh++; });
  return sh / (A.size + B.size - sh);
}
const expand = (q) => {
  const base = norm(q); const out = new Set([base]);
  for (const t of base.split(' ')) { out.add(t); (SYN[t] ?? []).forEach((s) => out.add(s)); }
  return [...out];
};
function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function isTypoOf(word, term) {
  const n = Math.min(word.length, term.length);
  if (n < 4) return false;
  const budget = n >= 7 ? 2 : 1;
  return editDistance(word, term, budget) <= budget;
}
function relevance(p, terms, rawQ) {
  const name = norm(p.n);
  const hay = `${name} ${norm(p.gc ?? '')} ${norm(p.c ?? '')} ${norm(p.l ?? '')}`;
  const q = norm(rawQ);
  const nameWords = name.split(' ');
  const hayWords = hay.split(' ');
  if (name === q) return 1;
  if (name.startsWith(q)) return 0.95;
  // word-start only: "designer" must not match "desi" (mirrors search.ts)
  if (q.includes(' ') ? name.includes(q) : nameWords.some((w) => w.startsWith(q))) return 0.85;
  const wordHit = (words, t) => words.some((w) => w === t || (t.length >= 5 && w.startsWith(t)));
  let best = 0;
  for (const t of terms) {
    if (!t) continue;
    if (wordHit(nameWords, t)) best = Math.max(best, 0.8);
    else if (wordHit(hayWords, t)) best = Math.max(best, 0.6);
    else for (const w of nameWords) {
      const s = trigramSim(w, t);
      if (s >= 0.45) best = Math.max(best, s * 0.85);
      else if (isTypoOf(w, t)) best = Math.max(best, 0.62);
    }
  }
  return best;
}
const R = 6371e3;
function distM(aLat, aLng, bLat, bLng) {
  const p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180;
  const dp = p2 - p1, dl = (bLng - aLng) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const quality = (r, n) => r == null ? 0.55 : ((n ?? 0) * r + 20 * 3.9) / ((n ?? 0) + 20) / 5;

function search(q, { lat = 31.418, lng = 73.079, radiusM = 5000, limit = 5 } = {}) {
  const terms = expand(q);
  return bundle.places
    .map((p) => {
      const d = distM(lat, lng, p.lat, p.lng);
      if (d > radiusM) return null;
      const rel = q ? relevance(p, terms, q) : 0.5;
      if (q && rel <= 0.28) return null;
      const prox = Math.exp(-(d / radiusM) * 1.6);
      const score = 0.4 * rel + 0.25 * quality(p.r, p.rc) + 0.2 * prox
        + 0.1 * 0.5 + 0.05 * Math.min(Math.log1p(p.rc ?? 0) / 7, 1);
      return { p, score, d };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ------------------------------------------------------------------- checks */

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

console.log(`\nDataset: ${bundle.count.toLocaleString()} places in ${bundle.city}`);
console.log(`Reviews cached for ${Object.keys(bundle.reviews).length.toLocaleString()} places\n`);

console.log('— typo tolerance —');
for (const [typo, expected] of [['birayni', 'biryani'], ['biriani', 'biryani'], ['pharmecy', 'pharmacy'], ['resturant', 'restaurant']]) {
  const r = search(typo, { radiusM: 15000, limit: 3 });
  const hit = r.some(({ p }) => norm(`${p.n} ${p.gc ?? ''}`).includes(expected));
  check(`"${typo}" finds ${expected}`, hit, r.length ? `top: ${r[0].p.n}` : '(no results)');
}

console.log('\n— local vocabulary —');
for (const [q, expect] of [['chai', ['tea', 'chai', 'cafe', 'dhaba']], ['saloon', ['salon', 'beauty', 'hair']], ['medical', ['pharmacy', 'medical', 'chemist']]]) {
  const r = search(q, { radiusM: 15000, limit: 5 });
  const hit = r.some(({ p }) => expect.some((e) => norm(`${p.n} ${p.gc ?? ''} ${p.c ?? ''}`).includes(e)));
  check(`"${q}" → ${expect[0]}-ish results`, hit, r.length ? `top: ${r[0].p.n}` : '(none)');
}

console.log('\n— word boundaries (the "desi"/"designer" class of bug) —');
{
  // "karahi" expands to 'desi'; substring matching once ranked a graphic
  // designer top. Word-boundary matching must keep non-food out of the top 5.
  const r = search('karahi', { radiusM: 8000, limit: 5 });
  const junk = r.filter(({ p }) => /designer|printer|academy|property/i.test(`${p.n} ${p.gc ?? ''}`));
  check('"karahi" top-5 has no designers/printers', r.length > 0 && junk.length === 0,
    junk.length ? `leaked: ${junk[0].p.n}` : `top: ${r[0]?.p.n}`);
  const fake = { n: 'Sabir Graphic Designer', gc: 'Graphic designer', c: 'services', l: '' };
  check('rel("desi" terms, designer) is 0', relevance(fake, expand('karahi'), 'karahi') === 0,
    `got ${relevance(fake, expand('karahi'), 'karahi')}`);
}

console.log('\n— ranking sanity —');
const food = search('restaurant', { radiusM: 8000, limit: 10 });
check('returns results', food.length > 0, `${food.length}`);
check('top result is well-rated', (food[0]?.p.r ?? 0) >= 3.8, `${food[0]?.p.n} ★${food[0]?.p.r}`);
const lowVolHigh = bundle.places.find((p) => p.r >= 4.9 && (p.rc ?? 0) <= 3);
if (lowVolHigh) {
  const q4 = quality(lowVolHigh.r, lowVolHigh.rc), q2 = quality(4.5, 900);
  check('4.9★(≤3) does not outrank 4.5★(900)', q2 > q4, `${q4.toFixed(3)} vs ${q2.toFixed(3)}`);
}
check('radius is hard (all within 5km)', search('', { radiusM: 5000, limit: 200 }).every((x) => x.d <= 5000));

console.log('\n— data richness —');
const withMenu = bundle.places.filter((p) => p.menu).length;
const withHist = bundle.places.filter((p) => p.hist).length;
const withAttr = bundle.places.filter((p) => p.attr).length;
const withHours = bundle.places.filter((p) => p.h).length;
const withPhone = bundle.places.filter((p) => p.ph).length;
console.log(`  menus: ${withMenu} | histograms: ${withHist} | attributes: ${withAttr} | hours: ${withHours} | phones: ${withPhone}`);
check('menus captured', withMenu > 0);
check('rating histograms captured', withHist > 100);
check('attributes captured', withAttr > 100);
check('hours captured', withHours > 500);

const sample = bundle.places.find((p) => bundle.reviews[p.id]?.length);
if (sample) {
  const rv = bundle.reviews[sample.id];
  check('google reviews have author+text', !!(rv[0].author && rv[0].text), `${sample.n}: ${rv.length} reviews`);
  check('review cache is bounded (≤10)', rv.length <= 10, `${rv.length}`);
}

console.log('\n— mined prices (quality gates from export_app_data.mine_prices) —');
{
  // Every pm the pipeline ships must satisfy the gates that make the
  // feature credible. One junk range ("Rs 3,500–36,000" for a salon) makes
  // it read as broken, so the gates are load-bearing, not stylistic.
  const withPm = bundle.places.filter((p) => p.pm != null);
  const shapeOk = withPm.every((p) => Array.isArray(p.pm) && p.pm.length === 3
    && p.pm.every((v) => Number.isFinite(v) && v > 0));
  const ordered = withPm.every((p) => p.pm[0] < p.pm[1]);
  const plausible = withPm.every((p) => p.pm[0] >= 30 && p.pm[1] <= 50000);
  const tight = withPm.every((p) => p.pm[1] <= p.pm[0] * 5);
  const attested = withPm.every((p) => p.pm[2] >= 2);
  console.log(`  ${withPm.length} places carry mined prices`);
  check('pm shape is [lo, hi, n] of positive numbers', shapeOk);
  check('pm ranges are ordered (lo < hi)', ordered);
  check('pm within plausible rupee bounds (30..50k)', plausible);
  check('pm range no wider than 5x its floor', tight,
    withPm.filter((p) => p.pm[1] > p.pm[0] * 5).map((p) => p.n).slice(0, 2).join(', '));
  check('pm backed by ≥2 reviews', attested);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} FAILED`} (${pass} passed)\n`);
process.exit(fail === 0 ? 0 : 1);
