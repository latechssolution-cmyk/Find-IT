/**
 * MapLibre wrapper (PRD §6.5), written against maplibre-react-native v11.
 *
 * Tiles: OpenFreeMap — unlimited, commercial-OK, no key, no billing account.
 * Deliberately NOT Google: our database is our own, and rendering it on a
 * Google map would drag in their terms for no benefit (PRD §2.1).
 *
 * Markers follow Airbnb's rule: rating pills, not anonymous pins, and only the
 * top-N ranked results are drawn so the map never turns to soup.
 */

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera, GeoJSONSource, Layer, Map as MLMap, Marker, UserLocation,
  type CameraRef, type MapRef,
} from '@maplibre/maplibre-react-native';

import { colors, choc } from '../theme';
import type { Place } from '../data';
import { useScheme } from './useScheme';
import { thinForZoom } from './mapThin';

export const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
export const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

/** Airbnb-style density cap: showing every pin is worse than showing the best. */
export const MAX_MARKERS = 30;

/** Caramel, not the brand chocolate: on a pale basemap chocolate reads as a
 *  smudge, and the radius circle needs to be legible without shouting. */
const RADIUS_TINT = '#C07525';

export interface MapHandle {
  flyTo(lng: number, lat: number, zoom?: number): void;
  fitBounds(sw: [number, number], ne: [number, number], padding?: number): void;
}

interface Props {
  places?: Place[];
  center: [number, number];              // [lng, lat]
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

/** MapLibre has no circle primitive — a polygon is the standard approach. */
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
    onRegionChangeStart, radiusM, showUser = true, interactive = true, children },
  ref,
) {
  const sch = useScheme();
  const c = colors(sch);
  const cam = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const [liveZoom, setLiveZoom] = useState(zoom);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, z) {
      cam.current?.flyTo({ center: [lng, lat], zoom: z ?? zoom, duration: 550 });
    },
    fitBounds(sw, ne, padding = 60) {
      cam.current?.fitBounds([sw, ne] as any, {
        padding: { top: padding, bottom: padding, left: padding, right: padding },
        duration: 500,
      });
    },
  }), [zoom]);

  const shown = useMemo(
    () => thinForZoom(places.slice(0, MAX_MARKERS), liveZoom, selectedId),
    [places, liveZoom, selectedId],
  );
  const circle = useMemo(
    () => (radiusM ? circlePolygon(center[0], center[1], radiusM) : null),
    [radiusM, center],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <MLMap
        ref={map}
        style={StyleSheet.absoluteFill}
        mapStyle={sch === 'dark' ? STYLE_DARK : STYLE_LIGHT}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        compass={false}
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        onRegionWillChange={onRegionChangeStart}
        onRegionDidChange={(e) => {
          const vs = e?.nativeEvent as any;
          const ctr = vs?.center ?? vs?.geometry?.coordinates;
          const z = vs?.zoom ?? zoom;
          setLiveZoom(z);   // re-thin markers for the new zoom
          if (ctr && onRegionChange) {
            onRegionChange(Array.isArray(ctr) ? [ctr[0], ctr[1]] : [ctr.lng, ctr.lat], z);
          }
        }}
      >
        <Camera ref={cam} center={center} zoom={zoom} />

        {showUser ? <UserLocation /> : null}

        {circle ? (
          <GeoJSONSource id="radius-src" data={circle}>
            <Layer
              id="radius-fill"
              type="fill"
              paint={{ 'fill-color': RADIUS_TINT, 'fill-opacity': 0.12 }}
            />
            <Layer
              id="radius-line"
              type="line"
              paint={{ 'line-color': RADIUS_TINT, 'line-width': 1.5, 'line-opacity': 0.85 }}
            />
          </GeoJSONSource>
        ) : null}

        {shown.map((p) => {
          const selected = p.id === selectedId;
          return (
            <Marker key={p.id} id={p.id} lngLat={[p.lng, p.lat]} anchor="center">
              <View
                onTouchEnd={() => onSelect?.(p)}
                style={[
                  styles.pill,
                  {
                    backgroundColor: selected ? c.brand : c.surface,
                    borderColor: selected ? c.brand : c.border,
                    shadowColor: choc[1000],
                    transform: [{ scale: selected ? 1.16 : 1 }],
                  },
                ]}
              >
                {p.rating != null ? (
                  <View style={styles.pillRow}>
                    <View style={[styles.star, { backgroundColor: selected ? c.onBrand : c.star }]} />
                    <Text style={[styles.pillText, { color: selected ? c.onBrand : c.textHeading }]}>
                      {p.rating.toFixed(1)}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.pillText, { color: selected ? c.onBrand : c.textMuted }]}>•</Text>
                )}
              </View>
            </Marker>
          );
        })}

        {children}
      </MLMap>
    </View>
  );
});

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1, minWidth: 36, alignItems: 'center',
    shadowOpacity: 0.14, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: -0.2 },
  star: { width: 6, height: 6, borderRadius: 3 },
});
