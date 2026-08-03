/**
 * Location state (PRD §5.1, §5.3).
 *
 * Rules baked in here:
 *   - when-in-use only; background location is never requested (Play policy)
 *   - Balanced accuracy (~100 m) is plenty for "what's near me" and is far
 *     cheaper on battery than High
 *   - the app is FULLY usable when permission is denied: we fall back to the
 *     city centre and the manual picker
 */

import { create } from './store';
import * as Location from 'expo-location';
import { useEffect } from 'react';

export interface Coords { lat: number; lng: number }

export const FAISALABAD: Coords = { lat: 31.418, lng: 73.079 };
export const DEFAULT_RADIUS_M = 5000;

interface LocState {
  coords: Coords | null;
  label: string | null;
  radiusM: number;
  permission: 'unknown' | 'granted' | 'denied';
  manual: boolean;
  setRadius(m: number): void;
  setManual(c: Coords, label?: string | null): void;
  request(): Promise<boolean>;
  init(): Promise<void>;
}

export const useLocationStore = create<LocState>((set, get) => ({
  coords: FAISALABAD,
  label: 'Faisalabad',
  radiusM: DEFAULT_RADIUS_M,
  permission: 'unknown',
  manual: false,

  setRadius: (m) => set({ radiusM: m }),

  setManual: (c, label) => set({ coords: c, label: label ?? null, manual: true }),

  async request() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      set({ permission: 'denied' });
      return false;
    }
    set({ permission: 'granted' });
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      set({ coords: c, manual: false });
      reverseGeocode(c).then((l) => l && set({ label: l }));
    } catch {
      /* keep the fallback centre; never block the UI on a GPS timeout */
    }
    return true;
  },

  async init() {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') await get().request();
  },
}));

/** Debounced reverse geocode via the OS geocoder (free, no key, no network
 *  policy to honour). Failure is silent — the label is decoration. */
export async function reverseGeocode(c: Coords): Promise<string | null> {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng });
    if (!r) return null;
    return r.district || r.subregion || r.city || r.region || null;
  } catch {
    return null;
  }
}

export function useLocation() {
  const s = useLocationStore();
  useEffect(() => { s.init(); /* eslint-disable-next-line */ }, []);
  return s;
}
