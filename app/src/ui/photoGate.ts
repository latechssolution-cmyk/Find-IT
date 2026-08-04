/**
 * The on-device gate every photo passes before it is allowed to leave.
 *
 * Runs BEFORE upload, on purpose. A face that is never uploaded needs no
 * blurring, no deletion policy and no explanation — and the user finds out
 * instantly, while the camera is still open, instead of minutes later.
 *
 * This is not security. A modified client skips all of it, which is why the
 * `moderate` Edge Function repeats both checks server-side and is the only
 * thing that can move a post to 'live'. This layer exists to be fast, free
 * and kind: no quota, no network, no waiting.
 *
 * Order matters — cheapest and most certain first:
 *   1. resize + strip EXIF   (also removes the GPS of someone's home)
 *   2. faces                 (ML Kit, on-device, free, unlimited)
 *   3. NSFW                  (NSFWJS, on-device, ~90%)
 */

import * as ImageManipulator from 'expo-image-manipulator';

export type GateReason = 'faces' | 'nsfw' | 'unreadable';

export interface GateResult {
  ok: boolean;
  reason?: GateReason;
  /** Processed, upload-ready file. Only present when ok. */
  uri?: string;
  width?: number;
  height?: number;
  /** For tuning thresholds later; never shown to the user. */
  scores?: Record<string, number>;
}

/** 1080px wide at ~200 KB keeps 10 GB of R2 at roughly 50,000 photos. */
const MAX_WIDTH = 1080;
const QUALITY = 0.72;

/** NSFWJS reports five classes. `sexy` is included deliberately: for a feed
 *  of food and shopfronts, rejecting a borderline gym shot costs nothing. */
const NSFW_LIMIT = 0.30;

/* Both native modules are optional. On web, and on a device without them,
   the gate degrades to resize-only and the SERVER still enforces the rules —
   it must never be possible for a missing module to crash the composer. */
let faceMod: any | null | undefined;
let nsfwMod: any | null | undefined;

function loadFaces() {
  if (faceMod !== undefined) return faceMod;
  try { faceMod = require('@react-native-ml-kit/face-detection').default; }
  catch { faceMod = null; }
  return faceMod;
}

function loadNsfw() {
  if (nsfwMod !== undefined) return nsfwMod;
  try { nsfwMod = require('nsfwjs'); } catch { nsfwMod = null; }
  return nsfwMod;
}

let nsfwModel: any = null;
async function nsfwPredict(uri: string): Promise<Record<string, number> | null> {
  const mod = loadNsfw();
  if (!mod) return null;
  try {
    // Loaded once and kept: the model is several MB and re-initialising it
    // per photo would make the composer feel broken.
    if (!nsfwModel) nsfwModel = await mod.load();
    const preds = await nsfwModel.classify(uri);
    return Object.fromEntries(
      (preds ?? []).map((p: any) => [String(p.className).toLowerCase(), Number(p.probability)]),
    );
  } catch {
    return null;
  }
}

export async function gatePhoto(uri: string): Promise<GateResult> {
  // 1. Normalise first. Everything downstream is cheaper on a smaller image,
  //    and the re-encode drops EXIF — including the GPS tag that would
  //    otherwise publish where the photographer lives.
  let prepared: ImageManipulator.ImageResult;
  try {
    prepared = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  // 2. Faces. The product rule is no people; this is a refusal, not a blur.
  const faces = loadFaces();
  if (faces) {
    try {
      const found = await faces.detect(prepared.uri, { performanceMode: 'fast' });
      if (Array.isArray(found) && found.length > 0) {
        return { ok: false, reason: 'faces', scores: { faces: found.length } };
      }
    } catch {
      // Detector unavailable — the server repeats this check.
    }
  }

  // 3. NSFW.
  const scores = await nsfwPredict(prepared.uri);
  if (scores) {
    const bad = (scores.porn ?? 0) + (scores.hentai ?? 0) + (scores.sexy ?? 0);
    if (bad >= NSFW_LIMIT) return { ok: false, reason: 'nsfw', scores };
  }

  return {
    ok: true,
    uri: prepared.uri,
    width: prepared.width,
    height: prepared.height,
    scores: scores ?? undefined,
  };
}

/** What the user is told. Never "rejected" alone — a refusal with no reason
 *  reads as a bug, and the author simply tries the same photo again. */
export function gateMessage(reason: GateReason): { title: string; body: string } {
  switch (reason) {
    case 'faces':
      return {
        title: 'No people, please',
        body: 'FIND IT photos are about the place — the food, the shop, the menu. '
          + 'Try a shot without anyone in frame.',
      };
    case 'nsfw':
      return {
        title: "That photo can't be posted",
        body: 'It looks like it may not be suitable. Try a photo of the place itself.',
      };
    default:
      return {
        title: "Couldn't read that photo",
        body: 'Try taking it again, or pick a different one.',
      };
  }
}
