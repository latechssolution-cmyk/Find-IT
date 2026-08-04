/**
 * Photo feed — client.
 *
 * Behind FEATURES.FEED. Every function returns empty rather than throwing
 * when the flag is off or the user is signed out, so the feature can be
 * wired into screens now and switched on later without touching them.
 *
 * The posting flow, and why it is ordered this way:
 *
 *   gatePhoto()   on-device: resize, strip EXIF, refuse faces and NSFW
 *   upload()      to R2 via a short-lived signed URL from an Edge Function
 *   insert row    status 'pending' — RLS will not accept any other value
 *   moderate()    server re-runs both checks and alone may set 'live'
 *
 * The client never decides what is publishable. It decides what is worth
 * uploading, which is a different and much cheaper question.
 */

import { FEATURES } from '../features';
import { supabase, hasSupabase, ensureCloudUser } from './supabaseSource';
import { gatePhoto, type GateReason } from '../ui/photoGate';

export interface FeedPost {
  id: string;
  placeId: string;
  placeName: string;
  photoUrl: string;
  caption: string | null;
  stars: number | null;
  tags: string[];
  createdAt: string;
  distanceM: number | null;
}

/** Public base of the R2 bucket. Keys are stored, URLs are derived — the
 *  bucket or CDN host can change without rewriting a single row. */
const R2_BASE = process.env.EXPO_PUBLIC_R2_BASE ?? '';
const photoUrl = (key: string) => (R2_BASE ? `${R2_BASE}/${key}` : key);

export const feedEnabled = () => FEATURES.FEED && hasSupabase && !!supabase;

function toPost(r: any): FeedPost {
  return {
    id: r.id,
    placeId: r.place_id,
    placeName: r.place_name ?? '',
    photoUrl: photoUrl(r.photo_key),
    caption: r.caption ?? null,
    stars: r.stars ?? null,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    distanceM: r.distance_m != null ? Number(r.distance_m) : null,
  };
}

export async function fetchFeed(
  lat: number, lng: number, opts: { radiusM?: number; limit?: number; offset?: number } = {},
): Promise<FeedPost[]> {
  if (!feedEnabled()) return [];
  try {
    const { data, error } = await supabase!.rpc('feed_nearby', {
      lat, lng,
      radius_m: opts.radiusM ?? 25000,
      lim: opts.limit ?? 30,
      off: opts.offset ?? 0,
    });
    if (error) return [];
    return (data ?? []).map(toPost);
  } catch {
    return [];
  }
}

/** Photos for one place — for the place screen, once the flag is on. */
export async function fetchPlacePosts(placeId: string, limit = 12): Promise<FeedPost[]> {
  if (!feedEnabled()) return [];
  try {
    const { data, error } = await supabase!.rpc('place_posts', { pid: placeId, lim: limit });
    if (error) return [];
    return (data ?? []).map((r: any) => toPost({ ...r, place_id: placeId }));
  } catch {
    return [];
  }
}

/** The signed-in user's own posts, any status — a rejected post must stay
 *  visible to its author, with its reason, or they simply post it again. */
export async function fetchMyPosts(): Promise<(FeedPost & { status: string; rejectReason: string | null })[]> {
  if (!feedEnabled()) return [];
  const uid = await ensureCloudUser();
  if (!uid) return [];
  try {
    const { data, error } = await supabase!
      .from('post')
      .select('id,place_id,photo_key,caption,stars,tags,created_at,status,reject_reason')
      .eq('author_id', uid)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) return [];
    return (data ?? []).map((r: any) => ({
      ...toPost({ ...r, place_name: '' }),
      status: r.status,
      rejectReason: r.reject_reason ?? null,
    }));
  } catch {
    return [];
  }
}

export type PostOutcome =
  | { ok: true; postId: string }
  | { ok: false; reason: GateReason | 'signin' | 'upload' | 'disabled' };

export async function createPost(
  localUri: string,
  placeId: string,
  caption?: string,
  stars?: number,
): Promise<PostOutcome> {
  if (!feedEnabled()) return { ok: false, reason: 'disabled' };

  // Refuse before uploading. A face that never leaves the phone needs no
  // deletion policy, and the user hears about it immediately.
  const gate = await gatePhoto(localUri);
  if (!gate.ok || !gate.uri) return { ok: false, reason: gate.reason ?? 'upload' };

  const uid = await ensureCloudUser();
  if (!uid) return { ok: false, reason: 'signin' };

  try {
    // Short-lived signed PUT, minted server-side: the R2 credentials never
    // reach the client.
    const { data: signed, error: signErr } = await supabase!.functions.invoke('sign-upload', {
      body: { contentType: 'image/jpeg' },
    });
    if (signErr || !signed?.url || !signed?.key) return { ok: false, reason: 'upload' };

    const blob = await (await fetch(gate.uri)).blob();
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!put.ok) return { ok: false, reason: 'upload' };

    const { data: row, error: insErr } = await supabase!
      .from('post')
      .insert({
        author_id: uid,
        place_id: placeId,
        photo_key: signed.key,
        width: gate.width,
        height: gate.height,
        caption: caption?.trim() || null,
        stars: stars ?? null,
        // status omitted on purpose: the column defaults to 'pending' and
        // RLS refuses any other value on insert.
      })
      .select('id')
      .single();
    if (insErr || !row) return { ok: false, reason: 'upload' };

    // Fire and forget. The row is already 'pending' and therefore invisible;
    // if this call fails the post simply waits for the sweeper rather than
    // going live unchecked.
    supabase!.functions.invoke('moderate', { body: { post_id: row.id } }).catch(() => {});

    return { ok: true, postId: row.id };
  } catch {
    return { ok: false, reason: 'upload' };
  }
}

export async function reportPost(postId: string, reason: string): Promise<boolean> {
  if (!feedEnabled()) return false;
  const uid = await ensureCloudUser();
  if (!uid) return false;
  try {
    const { error } = await supabase!
      .from('post_report')
      .insert({ post_id: postId, reporter_id: uid, reason });
    // A duplicate is a success from the user's point of view — they reported
    // it, and the one-per-person key did its job.
    return !error || error.code === '23505';
  } catch {
    return false;
  }
}
