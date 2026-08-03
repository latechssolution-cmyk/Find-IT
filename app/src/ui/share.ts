/**
 * Sharing a place.
 *
 * This is the app's only free distribution channel: in Pakistan the share
 * target is overwhelmingly WhatsApp, and a shared place is how someone who
 * has never heard of FIND IT first sees it. So the payload has to be useful
 * on its own — a bare deep link into an app the recipient doesn't have is a
 * dead end, while name + rating + landmark + a Maps link is useful even to
 * someone who never installs.
 */

import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import type { Place } from '../data';

/** Google Maps link — works for everyone, installed or not. */
export function mapsLink(place: Pick<Place, 'lat' | 'lng' | 'googlePlaceId'>): string {
  const base = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  return place.googlePlaceId ? `${base}&query_place_id=${place.googlePlaceId}` : base;
}

export function buildShareText(
  place: Place,
  landmark?: { name: string; distanceM: number } | null,
): string {
  const lines: string[] = [place.name];

  const bits: string[] = [];
  if (place.rating != null) {
    bits.push(`★ ${place.rating.toFixed(1)}${place.ratingCount ? ` (${place.ratingCount})` : ''}`);
  }
  if (place.googleCategory) bits.push(place.googleCategory);
  if (bits.length) lines.push(bits.join(' · '));

  // The landmark is the most useful line for a Pakistani recipient — far more
  // actionable than a postal-style address.
  if (landmark) {
    const d = landmark.distanceM < 950
      ? `${Math.round(landmark.distanceM / 10) * 10} m`
      : `${(landmark.distanceM / 1000).toFixed(1)} km`;
    lines.push(`${d} from ${landmark.name}`);
  } else if (place.locality) {
    lines.push(place.locality);
  }

  if (place.phone) lines.push(place.phone);
  lines.push('', mapsLink(place), '', 'Shared from FIND IT');
  return lines.join('\n');
}

export async function sharePlace(
  place: Place,
  landmark?: { name: string; distanceM: number } | null,
): Promise<'shared' | 'copied' | 'cancelled'> {
  const message = buildShareText(place, landmark);
  try {
    const res = await Share.share(
      { message, title: place.name },
      { dialogTitle: `Share ${place.name}` },
    );
    return res.action === Share.sharedAction ? 'shared' : 'cancelled';
  } catch {
    // Desktop web has no navigator.share, and RN Web throws rather than
    // returning — without this the button is silently dead there.
    if (Platform.OS === 'web') {
      try {
        await Clipboard.setStringAsync(message);
        return 'copied';
      } catch { /* clipboard blocked */ }
    }
    return 'cancelled';   // user dismissed, or no share target
  }
}
