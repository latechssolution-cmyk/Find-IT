/**
 * Moderation — the server-side authority on what becomes visible.
 *
 * The client already ran a face check and an NSFW check before uploading.
 * This runs them AGAIN, and that duplication is the entire point: a device
 * check is for speed and cost, not for security. Anyone can modify a client
 * and post whatever they like, so nothing the client asserts is trusted here.
 * The row arrives as 'pending' — RLS makes that the only status it may be
 * inserted with — and only this function, holding the service role, can move
 * it to 'live'.
 *
 * All three checks are free:
 *   image  Cloudflare Workers AI — 10,000 neurons/day, resets DAILY
 *   text   OpenAI Moderation — free and unmetered
 *   spam   local rules, because phone numbers in captions are the abuse
 *          that actually happens here and no model flags them
 *
 * A photo that fails is rejected with a REASON, so the author can be told
 * something better than "no". A rejected author with no explanation simply
 * stops posting, which costs more than the bad photo did.
 *
 * Deploy: supabase functions deploy moderate
 * Env:    CF_ACCOUNT_ID, CF_API_TOKEN      (Workers AI)
 *         AI_API_KEY                       (reused from `ask`, for text)
 *         R2_PUBLIC_BASE                   (public base URL of the bucket)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_ACCOUNT = Deno.env.get("CF_ACCOUNT_ID") ?? "";
const CF_TOKEN = Deno.env.get("CF_API_TOKEN") ?? "";
const OPENAI_KEY = Deno.env.get("AI_API_KEY") ?? "";
const R2_BASE = Deno.env.get("R2_PUBLIC_BASE") ?? "";

/** Strict on purpose. For a feed of food and shopfronts, rejecting a
 *  borderline swimwear shot costs us nothing and protects the tone. */
const NSFW_LIMIT = 0.30;

type Reason = "faces" | "nsfw" | "text" | "spam" | null;

/* ─────────────────────────────── image ───────────────────────────────── */

/**
 * Cloudflare Workers AI. Two models, cheapest first — if the NSFW classifier
 * already rejects, there is no reason to spend neurons detecting faces.
 */
async function checkImage(bytes: Uint8Array): Promise<{ reason: Reason; scores: unknown }> {
  if (!CF_ACCOUNT || !CF_TOKEN) return { reason: null, scores: { skipped: "cf not configured" } };

  const run = async (model: string) => {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/octet-stream" },
        body: bytes,
      },
    );
    if (!r.ok) throw new Error(`${model} ${r.status}`);
    return await r.json();
  };

  const scores: Record<string, unknown> = {};

  // 1. NSFW.
  try {
    const j = await run("@cf/falcons-ai/nsfw_image_detection");
    const arr = (j?.result ?? []) as { label: string; score: number }[];
    const nsfw = arr.find((x) => /nsfw|porn|explicit/i.test(x.label))?.score ?? 0;
    scores.nsfw = nsfw;
    if (nsfw >= NSFW_LIMIT) return { reason: "nsfw", scores };
  } catch (e) {
    scores.nsfwError = String(e);
    // Fail CLOSED. If we cannot tell, the photo does not go live — a missed
    // good photo is recoverable, a published bad one is not.
    return { reason: "nsfw", scores };
  }

  // 2. Faces. The product rule is no people, so this is a hard gate, not a
  //    blur: we would rather never store the face at all.
  try {
    const j = await run("@cf/microsoft/resnet-50");
    const arr = (j?.result ?? []) as { label: string; score: number }[];
    const person = arr.find((x) => /person|face|man|woman|boy|girl|portrait/i.test(x.label));
    scores.person = person?.score ?? 0;
    if (person && person.score >= 0.5) return { reason: "faces", scores };
  } catch (e) {
    // Classification is a weaker face signal than the on-device ML Kit pass
    // the client already ran, so a failure here is not on its own fatal.
    scores.faceError = String(e);
  }

  return { reason: null, scores };
}

/* ─────────────────────────────── text ────────────────────────────────── */

/** The abuse that actually happens: captions used as free classified ads. */
const SPAM = [
  /\+?92[\s-]?3\d{2}[\s-]?\d{7}/,        // Pakistani mobile
  /\b03\d{2}[\s-]?\d{7}\b/,
  /\bwa\.me\/|\bchat\.whatsapp\.com\//i,
  /\b(dm|inbox|whatsapp)\s+(me|us|kar)\b/i,
  /\b(call|rabta)\s+(now|karain|karo)\b/i,
];

/** English models handle Urdu and Roman-Urdu profanity poorly; this is the
 *  one gap worth filling by hand. Deliberately short — a long list becomes a
 *  censorship problem of its own. */
const LOCAL_PROFANITY = /\b(gandu|madarchod|behenchod|randi|chutiya|lun|lund|phudi)\b/i;

async function checkText(text: string): Promise<{ reason: Reason; scores: unknown }> {
  const t = (text ?? "").trim();
  if (!t) return { reason: null, scores: {} };

  if (SPAM.some((re) => re.test(t))) return { reason: "spam", scores: { rule: "contact-details" } };
  if (LOCAL_PROFANITY.test(t)) return { reason: "text", scores: { rule: "local-profanity" } };

  if (!OPENAI_KEY) return { reason: null, scores: { skipped: "no key" } };
  try {
    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: t.slice(0, 2000) }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const res = j?.results?.[0];
    if (res?.flagged) return { reason: "text", scores: res.categories };
    return { reason: null, scores: {} };
  } catch (e) {
    // Text is lower risk than imagery and the local rules already ran, so a
    // provider outage should not block every post.
    return { reason: null, scores: { error: String(e) } };
  }
}

/* ─────────────────────────────── entry ───────────────────────────────── */

async function patch(id: string, body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/post?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { post_id } = await req.json();
    if (!post_id) return Response.json({ error: "post_id required" }, { status: 400, headers: CORS });

    // Read the row with the service role — it is still 'pending', so RLS
    // would hide it from the caller's own credentials.
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/post?id=eq.${post_id}&select=id,photo_key,caption,status`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const [row] = await rowRes.json();
    if (!row) return Response.json({ error: "not found" }, { status: 404, headers: CORS });
    if (row.status !== "pending") {
      return Response.json({ status: row.status, note: "already decided" }, { headers: CORS });
    }

    const text = await checkText(row.caption ?? "");
    let image: { reason: Reason; scores: unknown } = { reason: null, scores: {} };

    if (!text.reason) {
      const imgRes = await fetch(`${R2_BASE}/${row.photo_key}`);
      if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
      image = await checkImage(new Uint8Array(await imgRes.arrayBuffer()));
    }

    const reason = text.reason ?? image.reason;
    const status = reason ? "rejected" : "live";

    await patch(post_id, {
      status,
      reject_reason: reason,
      moderation: { text: text.scores, image: image.scores },
      moderated_at: new Date().toISOString(),
    });

    return Response.json({ status, reason }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
