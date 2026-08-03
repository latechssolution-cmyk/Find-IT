/**
 * Zoom-aware marker thinning, shared by both Map implementations.
 *
 * The problem: 30 pills in a 2 km radius all sit on the same bazaar block at
 * zoom 12 and stack into an unreadable pile. Full symbol-layer clustering
 * would fix it but means abandoning DOM/RN markers (and the selection model)
 * on both platforms.
 *
 * The 90% answer: bucket places into screen-space cells (~64 px at the
 * current zoom) and keep only the best-scored place per cell. Zooming in
 * shrinks cells geographically, so pins "un-merge" exactly like clusters —
 * without a cluster count bubble, which we don't want anyway: results are
 * already capped and ranked, the map is a picker, not a census.
 *
 * The list is ranking-ordered, so "first seen in cell wins" IS "best wins".
 * The selected place always survives thinning — the pin you tapped must
 * never vanish under you.
 */

import type { Place } from '../data';

/** Screen pixels per thinning cell. Pill ≈ 44×26 — a cell just under pill
 *  width allows near-touching pills but no full stacks; 64 proved too sparse
 *  (30 downtown pins thinned to 5 at city zoom). */
const CELL_PX = 40;

export function thinForZoom(places: Place[], zoom: number, selectedId?: string | null): Place[] {
  if (places.length <= 8) return places;

  // Web-Mercator: pixels per degree of longitude at this zoom (256px tiles).
  const worldPx = 256 * Math.pow(2, zoom);
  const pxPerLngDeg = worldPx / 360;
  const cellLng = CELL_PX / pxPerLngDeg;

  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of places) {
    // Latitude scale varies with cos(lat); good enough to use the row's own.
    const cellLat = cellLng * Math.cos((p.lat * Math.PI) / 180);
    const key = `${Math.floor(p.lng / cellLng)}:${Math.floor(p.lat / cellLat)}`;
    if (seen.has(key)) {
      if (p.id === selectedId) out.push(p);   // selection always survives
      continue;
    }
    seen.add(key);
    out.push(p);
  }
  return out;
}
