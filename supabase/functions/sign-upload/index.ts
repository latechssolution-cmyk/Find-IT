/**
 * Mints a short-lived signed PUT for Cloudflare R2.
 *
 * The client uploads straight to R2 — the bytes never pass through Supabase,
 * which keeps us inside the free tier's bandwidth and off its 1 GB storage
 * cap. What the client never gets is the R2 credentials: it receives one
 * URL, for one key, valid for five minutes.
 *
 * The key is server-generated. If the client chose it, one user could
 * overwrite another's photo by guessing a path.
 *
 * Deploy: supabase functions deploy sign-upload
 * Env:    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("R2_BUCKET") ?? "findit-photos";

const EXPIRY_SECONDS = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Signed-in users only. Anonymous uploads would leave nobody to ban, which
  // is the whole reason the feed needs accounts at all.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 40) {
    return Response.json({ error: "sign in required" }, { status: 401, headers: CORS });
  }

  if (!ACCOUNT || !KEY_ID || !SECRET) {
    return Response.json({ error: "R2 not configured" }, { status: 503, headers: CORS });
  }

  try {
    const { contentType } = await req.json().catch(() => ({ contentType: "image/jpeg" }));
    if (contentType !== "image/jpeg" && contentType !== "image/webp") {
      return Response.json({ error: "jpeg or webp only" }, { status: 400, headers: CORS });
    }

    // Date-sharded so a bucket listing stays navigable, random so keys are
    // unguessable.
    const day = new Date().toISOString().slice(0, 10);
    const key = `posts/${day}/${crypto.randomUUID()}.jpg`;

    const client = new AwsClient({
      accessKeyId: KEY_ID,
      secretAccessKey: SECRET,
      service: "s3",
      region: "auto",
    });

    const endpoint = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
    const signed = await client.sign(
      new Request(endpoint, { method: "PUT", headers: { "Content-Type": contentType } }),
      { aws: { signQuery: true }, headers: { "X-Amz-Expires": String(EXPIRY_SECONDS) } },
    );

    return Response.json({ url: signed.url, key, expiresIn: EXPIRY_SECONDS }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
