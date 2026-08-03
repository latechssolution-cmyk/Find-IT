/**
 * Web implementation of the map (Metro picks .web.tsx automatically).
 *
 * maplibre-react-native is native-only, so on web we drive maplibre-gl
 * directly. Same OpenFreeMap tiles, same rating-pill markers, same radius
 * circle — so the web build is a genuine preview of the native one, not a
 * mock. This is also what makes the app usable from a browser at all.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
// maplibre-gl's ESM build has no default export — named imports only.
import { Map as MLGLMap, Marker as MLGLMarker } from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { colors, choc } from '../theme';
import type { Place } from '../data';
import { useScheme } from './useScheme';
import { thinForZoom } from './mapThin';

export const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
export const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
export const MAX_MARKERS = 30;

/** Matches Map.tsx — caramel reads on a pale basemap where chocolate smudges. */
const RADIUS_TINT = '#C07525';

export interface MapHandle {
  flyTo(lng: number, lat: number, zoom?: number): void;
  fitBounds(sw: [number, number], ne: [number, number], padding?: number): void;
}

interface Props {
  places?: Place[];
  center: [number, number];
  zoom?: number;
  selectedId?: string | null;
  onSelect?: (p: Place) => void;
  onRegionChange?: (center: [number, number], zoom: number) => void;
  onRegionChangeStart?: () => void;
  radiusM?: number | null;
  showUser?: boolean;
  interactive?: boolean;
  children?: React.ReactNode;
}

function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latR = radiusM / 110574;
  const lngR = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export const Map = forwardRef<MapHandle, Props>(function Map(
  { places = [], center, zoom = 13, selectedId, onSelect, onRegionChange,
    onRegionChangeStart, radiusM, interactive = true },
  ref,
) {
  const sch = useScheme();
  const c = colors(sch);
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLGLMap | null>(null);
  const markers = useRef<MLGLMarker[]>([]);
  const ready = useRef(false);
  // Zoom drives marker thinning; a state tick re-runs the marker effect when
  // the user stops zooming (continuous re-render during pinch would thrash).
  const [zoomTick, setZoomTick] = React.useState(zoom);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, z) { map.current?.flyTo({ center: [lng, lat], zoom: z ?? zoom, duration: 550 }); },
    fitBounds(sw, ne, padding = 60) { map.current?.fitBounds([sw, ne], { padding, duration: 500 }); },
  }), [zoom]);

  /* --- create once --- */
  useEffect(() => {
    if (!host.current || map.current) return;
    const m = new MLGLMap({
      container: host.current,
      style: sch === 'dark' ? STYLE_DARK : STYLE_LIGHT,
      center,
      zoom,
      attributionControl: { compact: true },
      interactive,
    });
    map.current = m;
    m.on('load', () => { ready.current = true; m.resize(); });
    m.on('movestart', () => onRegionChangeStart?.());
    m.on('zoomend', () => setZoomTick(m.getZoom()));
    m.on('moveend', () => {
      const ctr = m.getCenter();
      onRegionChange?.([ctr.lng, ctr.lat], m.getZoom());
    });

    /**
     * React Native Web lays out AFTER mount, so the container is frequently
     * 0x0 at the moment MapLibre initialises. A zero-size map computes zero
     * visible tiles, requests none, and never recovers on its own — the
     * symptom is a map that shows only its background colour (which reads as
     * "black map" in dark mode) while the style, TileJSON and sprites all
     * load fine. Watching the container and resizing is the fix.
     */
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(host.current);
    const kick = setTimeout(() => m.resize(), 60);

    return () => {
      clearTimeout(kick);
      ro.disconnect();
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- theme switch --- */
  useEffect(() => {
    map.current?.setStyle(sch === 'dark' ? STYLE_DARK : STYLE_LIGHT);
  }, [sch]);

  /* --- radius circle --- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource('radius-src') as GeoJSONSource | undefined;
      if (!radiusM) {
        if (m.getLayer('radius-fill')) m.removeLayer('radius-fill');
        if (m.getLayer('radius-line')) m.removeLayer('radius-line');
        if (m.getSource('radius-src')) m.removeSource('radius-src');
        return;
      }
      const data = circlePolygon(center[0], center[1], radiusM) as any;
      if (src) { src.setData(data); return; }
      m.addSource('radius-src', { type: 'geojson', data });
      m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius-src',
        paint: { 'fill-color': RADIUS_TINT, 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius-src',
        paint: { 'line-color': RADIUS_TINT, 'line-width': 1.5, 'line-opacity': 0.85 } });
    };
    if (ready.current) apply(); else m.once('load', apply);
  }, [radiusM, center[0], center[1]]);

  /* --- markers --- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const shown = thinForZoom(places.slice(0, MAX_MARKERS), map.current?.getZoom() ?? zoom, selectedId);
    for (const p of shown) {
      const selected = p.id === selectedId;
      const el = document.createElement('div');
      el.style.cssText = [
        'display:flex', 'align-items:center', 'gap:4px',
        `background:${selected ? c.brand : c.surface}`,
        `border:1px solid ${selected ? c.brand : c.border}`,
        'border-radius:999px', 'padding:5px 10px', 'cursor:pointer',
        // warm shadow: a black shadow over a warm ground reads grey
        `box-shadow:0 3px 8px ${choc[1000]}24`,
        'font:700 12px system-ui,sans-serif', 'letter-spacing:-0.2px',
        `color:${selected ? c.onBrand : c.textHeading}`,
        `transform:scale(${selected ? 1.16 : 1})`,
        'transition:transform .18s cubic-bezier(.2,.8,.2,1)',
      ].join(';');
      const starColor = selected ? c.onBrand : c.star;
      el.innerHTML = p.rating != null
        ? `<span style="width:6px;height:6px;border-radius:3px;background:${starColor}"></span>${p.rating.toFixed(1)}`
        : '•';
      el.onclick = () => onSelect?.(p);
      markers.current.push(new MLGLMarker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
    }
  }, [places, selectedId, sch, zoomTick]);

  /* --- external centre changes --- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const cur = m.getCenter();
    if (Math.abs(cur.lng - center[0]) > 1e-6 || Math.abs(cur.lat - center[1]) > 1e-6) {
      m.jumpTo({ center });
    }
  }, [center[0], center[1]]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* raw div: maplibre-gl needs a real DOM node to mount into */}
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
});
