# Photo feed — how to moderate it without building moderation

Researched 4 Aug 2026. Brief: a review-driven feed / personal gallery, with
**no faces**, **nothing sexual**, and nothing otherwise weird — using free,
existing tools rather than anything we write ourselves.

**Verdict: buildable, entirely inside free tiers, and the "no faces" rule
turns out to be the cheapest requirement rather than the hardest.**

---

## The one decision that shapes everything

> **On-device first, server-side to confirm.**

Every per-image cloud API has a monthly quota. Every on-device model has
none — the user's phone does the work, for free, forever, offline, and the
photo never leaves the handset unless it passes. So the device does the
filtering, and the server re-checks only what survives.

That is not belt-and-braces for its own sake. **A device check alone is not
security**: anyone can modify a client and post whatever they like. The
device check exists for *speed and cost*; the server check exists for
*trust*. Both are free at our scale.

---

## Layer 1 — faces, on-device (free, unlimited, no quota)

**Google ML Kit face detection.** Runs entirely on the phone, costs nothing,
has no request limit, and needs no account.

- Package: [`@react-native-ml-kit/face-detection`](https://www.npmjs.com/package/@react-native-ml-kit/face-detection)
  — note **`expo-face-detector` is dead**: removed from Expo SDK 51+, and we
  are on 57. Do not follow older tutorials.
- Requires a dev build, which we already need for MapLibre. No new cost.

**Use it as a hard gate, before upload:**

```
faces = detect(photo)
if faces.length > 0  ->  refuse, explain, offer to crop
```

This is better than blurring: it never uploads a face at all, so there is no
"we stored it then blurred it" question, no bandwidth spent, and instant
feedback while the user still has the camera open. It also *sharpens the
product* — a feed of food, shopfronts and menus rather than selfies is a
clearer identity than "Instagram, but worse".

---

## Layer 2 — sexual / explicit content

Two credible free routes. **I'd take Cloudflare.**

| | Free allowance | Runs | Notes |
|---|---|---|---|
| **Cloudflare Workers AI** ⭐ | **10,000 neurons/day** ≈ **~8,300 image classifications/day**, resets daily ([source](https://aicreditmart.com/ai-credits-providers/cloudflare-workers-ai-free-tier-10k-neurons-day-guide-2026/)) | edge | Daily reset, not monthly — a bad day can't burn the month |
| **NSFWJS** | unlimited | device | MIT, ~90% accurate, 5 classes (neutral/drawing/sexy/hentai/porn) ([repo](https://github.com/infinitered/nsfwjs)) |
| Azure AI Content Safety | 5,000 images/**month** | cloud | Solid, but a month-long quota is easy to exhaust |
| AWS Rekognition | 5,000/month, **12 months only** | cloud | Expires — a trap for a product meant to last |
| Google Vision SafeSearch | ~1,000/month | cloud | Too small |
| Sightengine | none — from $29/mo | cloud | Rules itself out |

**Recommended:** NSFWJS on device for instant feedback, Cloudflare Workers AI
on the server as the authority. A daily-resetting pool is materially safer
than a monthly one, and ~8,300/day is far beyond anything a launch produces.

**Set the threshold deliberately.** NSFWJS's `sexy` class catches swimwear
and gym photos. For a food-and-shops feed the strict setting costs us almost
nothing and protects the tone — reject on `porn + hentai + sexy` combined
above ~0.3, not just hard porn.

---

## Layer 3 — the words

**OpenAI Moderation API is free and does not count against usage limits**
([docs](https://platform.openai.com/docs/guides/moderation)) — genuinely
free, not a trial. It covers sexual, hateful, violent and self-harm
categories, and takes an API key we may already have for the `ask` function.

Cheap non-AI checks worth stacking in front of it, because they are instant
and catch the common cases:

- phone numbers / WhatsApp links in captions → spam, the dominant abuse here
- ALL CAPS, repeated emoji, "DM me"
- a wordlist for Urdu and Roman-Urdu profanity, which English-trained models
  handle poorly — this is the one gap worth hand-filling

---

## Layer 4 — humans, cheaply

We already have most of it. The report flow, the one-tap kinds, the local
queue — it exists and is wired. The feed needs one more report reason
("inappropriate photo") and an admin view.

Rule of thumb worth adopting: **auto-hide on the 2nd independent report**,
pending review. Cheaper than pre-moderating everything, and fast enough that
nothing sits visible for long.

---

## Where the photos live

Storage is the sleeper cost, and Supabase is the wrong tool for it.

| | Free | Egress |
|---|---|---|
| Supabase Storage | 1 GB | 5 GB/mo |
| **Cloudflare R2** ⭐ | **10 GB** | **unlimited, free** |

R2 is the clear answer: 10× the storage and, critically, **zero egress
charges** — an image feed is almost entirely egress, and that is exactly
where surprise bills come from. S3-compatible, so it takes standard tooling.

Resize and strip EXIF on device before upload. A 1080px-wide JPEG at ~200 KB
means 10 GB holds roughly **50,000 photos**, and stripping EXIF removes GPS
coordinates from someone's home — a privacy leak that would otherwise ride
along in every upload.

---

## One thing to get right, or the feed is a liability

> **Only user-submitted photos may appear in the feed. Never scraped Google
> photos.**

Showing a Google photo on a place page with attribution is one thing — the
Play audit already flags it as our sharpest risk. Republishing those same
photos into a social feed is a different and much worse posture: it looks
like our content, it is the product's public face, and it is exactly what an
IP complaint would point at. The feed must be built only from what users
themselves upload.

---

## The stack, and what it costs

| Layer | Tool | Cost |
|---|---|---|
| Faces | ML Kit, on device | **£0**, no quota |
| NSFW (instant) | NSFWJS, on device | **£0**, no quota |
| NSFW (authority) | Cloudflare Workers AI | **£0** to ~8,300/day |
| Text | OpenAI Moderation | **£0**, unmetered |
| Spam / profanity | our own wordlist | **£0** |
| Storage | Cloudflare R2 | **£0** to 10 GB, free egress |
| Human | existing report flow + auto-hide | **£0** |

**Nothing here breaks the free-tier rule, and nothing expires after 12
months.**

---

## What I'd actually build, in order

1. **Upload path with the face gate** — camera → resize → strip EXIF → ML Kit
   → NSFWJS → upload to R2. Refusals never leave the phone.
2. **Server confirmation** — an Edge Function re-runs NSFW via Workers AI and
   text via OpenAI before a row becomes visible. `status: pending → live`.
3. **The feed itself** — reverse-chronological, filtered to `live`, scoped to
   the user's city. Attach every photo to a place, so the feed feeds the
   database rather than floating beside it.
4. **Report + auto-hide** — extend the existing flow.
5. **Personal gallery** — "your photos", per user, which needs accounts
   (currently anonymous auth is written but disabled).

Steps 1–2 are the moderation spine. 3–5 are ordinary product work.

---

## Two risks worth naming now

1. **Accounts become mandatory.** A feed without identity is unmoderatable —
   there is nobody to ban. That triggers Play's **account-deletion
   requirement (in-app *and* a public web form)**, and rewrites the Data
   Safety answers from "not collected" to "collected", which today are our
   cleanest competitive claim.
2. **~90% accuracy means ~1 in 10 slips.** At 100 photos/day that is ~10
   wrong calls daily, in both directions. Plan for the false *positives* too:
   a rejected user with no appeal path simply stops posting.
