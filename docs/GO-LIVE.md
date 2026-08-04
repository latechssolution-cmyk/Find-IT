# Getting FIND IT into production — your steps

Only the things **you** must do. Everything else is done or I can do it once
you hand over the piece in bold. Ordered so nothing waits on anything below
it. Full policy reasoning lives in [PLAY-STORE-AUDIT.md](PLAY-STORE-AUDIT.md).

**Realistic timeline: ~2 weeks if the developer account is an organisation,
~3–4 weeks if it's a new personal account** (that path has a mandatory
14-day testing gate — start it on day one).

---

## Day 1 — the two clocks that run in the background

Do these first, because everything else can proceed while they tick.

### 1. Google Play developer account — **$25, one-off**
[play.google.com/console/signup](https://play.google.com/console/signup)

You must choose:

| | Personal | Organisation |
|---|---|---|
| Needs | ID + address | registered business + **D-U-N-S number** (free, but **up to 28–30 days** if you don't already hold one) |
| Gate | **12 testers × 14 continuous days** before production | **none** |
| Listing shows | your legal name | your company name |
| Team | one login | multiple users, survives staff changes |

**The decision rule:**

- **Already have a D-U-N-S?** → Organisation. No contest: no tester gate, and
  the listing carries the company name, which matters for a directory app
  asking people to trust its data. Look it up free at
  [dnb.com/duns-number/lookup](https://www.dnb.com/duns-number/lookup.html) —
  registered businesses often already have one without knowing.
- **Don't have one, and don't want to wait a month?** → Personal, and
  **create the closed test and recruit 12 testers on day one.**

The 12-tester rule is harder than it sounds: 12 real accounts, opted in and
*staying* opted in for 14 **continuous** days. People dropping out mid-way is
the usual reason this takes a month instead of two weeks. Over-recruit — aim
for 15–16 so a few drop-offs don't reset the clock.
([policy](https://support.google.com/googleplay/android-developer/answer/14151465))

### 2. Decide the audience — **I recommend 13+**
You told me "everyone including under 13". I'd push back once more: it forces
certified-only ad SDKs, kills personalized ad revenue, and puts unmoderated
reviews under child-safety scrutiny — for a market segment that doesn't
search for pharmacies. **Say the word and I'll set it to 13+.**

---

## Then — accounts and keys (about 30 minutes total)

Each is free. Give me the value and I wire it up the same day.

| # | What | Where | Free tier |
|---|---|---|---|
| 3 | **AI key** for the ask feature | [console.groq.com](https://console.groq.com) | generous, free |
| 4 | **Sentry DSN** — crash reporting | [sentry.io](https://sentry.io) | 5k errors/mo |
| 5 | **Hugging Face token** — unlocks the missing Foursquare seed data | [huggingface.co](https://huggingface.co) → accept the [dataset terms](https://huggingface.co/datasets/foursquare/fsq-os-places) → read token | free |
| 6 | **Cloudflare account** — R2 storage + Workers AI, for the feed | [cloudflare.com](https://cloudflare.com) | 10 GB, free egress |
| 7 | **EAS account** — builds the APK/AAB | [expo.dev](https://expo.dev) | 30 builds/mo |
| 8 | **Contact email** for the Play listing + privacy policy | must be monitored | — |

**On #5:** this is why every city is Overture-only. The dataset is gated;
the harvester has been failing silently since 30 July. One token unlocks a
second data source across all 15 cities.

---

## Then — two decisions only you can make

### 9. Google review text — the sharpest legal risk
We show Google review text and author names, attributed. Redistributing Maps
content runs against their platform terms, and Play enforcement is the same
company. Options, safest first:

- **(a)** drop cached review *text*, keep our own reviews + rating counts
- **(b)** keep a short snippet with attribution and a link out
- **(c)** leave as-is and accept the risk

I'd take (a) before launch and reinstate later if you get a licence. Our
Overture/Foursquare spine is clean — this is only the Google enrichment.

### 10. Ads and paid features — at launch, or after?
You said both at launch. Each adds real surface: ads bring the ads policy and
an SDK to declare; paid features bring Play Billing. **Launching free and
adding monetization in v1.1 is materially lower risk** and keeps our cleanest
selling point — no ads, no trackers, no account required.

---

## Then — hosting the policy (15 minutes)

### 11. Publish the privacy policy at a stable URL
[docs/PRIVACY.md](PRIVACY.md) is written and matches actual behaviour. It
needs your contact email, then hosting — GitHub Pages is free and fine.
A lawyer's read is advisable, not blocking.

---

## What I do once you've done the above

Nothing here needs you again:

- wire each key, deploy the `ask` Edge Function
- add Sentry, set launch-week alert thresholds
- `eas build` → **test the release binary on a real low-end Android** (the
  app has never run as a release build; Hermes and R8 differ from dev)
- verify the pre-launch report, RTL with Urdu, process-death restore
- run the offline and hanging-cloud suites against the real APK
- fill the Data Safety form from the prepared answers
- rebuild all cities with Foursquare folded in, once the HF token exists

---

## Already done — you don't need to think about these

- **targetSdk 36** pinned and verified — it was silently on 35, which would
  have been rejected outright from 31 Aug
- **Store assets** — icon, feature graphic, 4 screenshots at 1080×2340, all
  regenerating from the design tokens
- **Privacy policy** drafted; **Data Safety answers** prepared
- **Content rating** answers worked out; Child Safety Standards verified N/A
- **105,003 places** live in Mumbai, 28,588 with reviews
- **Foreground location only**, background blocked at the manifest — avoids
  the hardest permission review on Play
- Error boundaries, offline fallback, network deadlines, contrast, touch
  targets, screen-reader labels — all verified

---

## The honest risk list, shortest first

1. **The 14-day tester gate** if the account is personal. Start it today.
2. **Never built as a release binary.** Minification and Hermes behave
   differently; this is the most likely source of a launch-day surprise.
3. **No crash reporting yet.** If vitals degrade you'd learn from a Play
   warning, not telemetry.
4. **Google review text** (see #9).
5. **~1% of Islamabad grid cells** never scraped, and Lahore is still
   sweeping. Not a blocker — the app ships with what's there and improves.
