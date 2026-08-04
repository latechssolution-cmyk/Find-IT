# FIND IT — what would actually make this win

Researched 4 Aug 2026. Every idea below is checked against what the app
**already does**, so none of it is a repeat. Ordered by how hard it would be
for Google Maps — or a local clone — to copy.

The strategic point first: **we cannot out-Google Google on coverage or
freshness.** They have more data and more eyes. What they will never do is
build for the specific texture of Pakistani daily life, because the feature
would be meaningless in 190 other countries. That asymmetry is the entire
opportunity, and almost every idea below lives inside it.

---

## Tier 1 — moat. Google will never build these.

### 1. 🔌 Load-shedding awareness
**The insight.** A shop with no generator is *closed* during its feeder's
slot, whatever its posted hours say. Every Pakistani plans around this and no
map acknowledges it exists.

The Power Division's 2026 "Peak Relief Strategy" schedules ~2.25 h/day inside
the 5pm–1am window, published per-DISCO — FESCO (Faisalabad), LESCO (Lahore),
IESCO (Islamabad), GEPCO, MEPCO, PESCO — with urban feeders taking 4–6 h in
some areas.
([schedule](https://ibill.pk/news/load-shedding-pakistan-2026))

**What we'd ship.** On the place screen, next to hours:
> ⚡ *Area load-shedding 7–9pm. Call before going.*

And a filter: **"Has generator/backup"** — collected through the review-tag
flow that already exists.

**Why it's a moat.** It needs per-area schedule data, a generator signal
gathered from users, and a reason to care. Google has none of the three.
This alone is a reason to open FIND IT instead of Maps at 7pm.

### 2. 🕌 Prayer and Jummah closures
Shops shut for Zuhr, and most of a commercial street shuts **1–2:30pm on
Friday**. "Open now" that ignores this is simply wrong twice a day, and wrong
for two hours every Friday.

> *Closes for Jummah, 1:00–2:30pm Friday*

Prayer times are computable from lat/lng and date — no data deal, no API,
works offline. We already ship a Ramadan note; this is the same idea applied
to the other 11 months.

### 3. 👪 Family section mapping
Women are routinely advised to sit in the "family section" at restaurants and
dhabas — it is a real, load-bearing part of how people choose where to eat.
([context](https://musafirintransit.com/is-pakistan-safe-for-women/))
Google models none of it.

Three crowd-sourced facts, one tap each: **family section**, **separate
family entrance**, **women-only floor**. The review-tag flow already collects
structured tags, so the collection mechanism exists — this is new vocabulary,
not new machinery.

**Why it wins.** For a large fraction of users this is the *deciding* factor,
and we would be the only app that knows it.

### 4. 🏍️ Travel time by motorbike, not distance
"2.9 km" means very different things on a bike and in a car in Lahore
traffic. The bike takes lanes the car cannot.

> *8 min by bike · 22 min by car*

Bikes are the dominant private transport here. Showing car-time only — which
is all anyone does — is answering the wrong question for most users.

### 5. 💸 Real prices, mined from review text
Google's `$$` is meaningless locally, and we already convert it to a rough
PKR band. Far better: people *state prices in reviews* — "biryani plate 350",
"cut 500 mein". Extract them.

> *People mention Rs 300–450 · from 12 reviews*

We hold **28,588 places' worth of cached review text**. This is a batch job
over data we already have, and it produces something no competitor shows.

---

## Tier 2 — strong differentiators

### 6. ✅ "Still open?" confidence, not a binary
Today the app says Open or Closed from scraped hours. The honest answer is a
confidence built from: hours + when we last verified + user reports + popular
times + load-shedding overlap.

> *Probably open — but unverified for 3 months, and 2 people reported it closed*

Fits the app's existing honesty stance ("not yet verified", "Only 4 ratings")
and turns our biggest weakness — data age — into visible integrity.

### 7. 👍 "I went, it was open" — one tap
The strongest possible freshness signal, cheaper to give than a review. The
report flow already exists for *bad* news; this is the good-news counterpart,
and it makes every listing self-healing.

> *3 people confirmed this week*

### 8. 💬 WhatsApp-first business profiles
**>90% of Pakistani consumers prefer WhatsApp** for business contact, and it
is the primary sales channel for most businesses — ahead of websites.
([source](https://weproms.com/blog/whatsapp-marketing-pakistan-chat-to-sale-2026/))

We already deep-link. What's missing is treating it as *the* channel:
per-category prefilled messages ("Do you have a table for 4 tonight?", "Is
this in stock?", "What do you charge for a haircut?"), a **WhatsApp-only**
badge where there's no phone, and a *typically replies quickly* signal.

### 9. 🤝 Bargaining expected — yes or no
Fixed price or negotiable is genuinely useful information in local retail,
and it is invisible everywhere. One crowd-sourced flag, enormous everyday
value, zero competitors.

### 10. 🗳️ Send three, let the group pick
Outings here are decided in a WhatsApp group. Today we share one place.
Instead: shortlist three, share one message, everyone taps, the shortlist
shows the votes. **Every share becomes an install prompt** — our only free
distribution channel doing double duty.

### 11. 🚚 "Delivers to *you*" — not just "has delivery"
A delivery flag is close to useless; the question is always whether they
deliver *here*. Crowd-sourced delivery radius, then filter honestly by the
user's actual location.

### 12. 🎉 Occasion modes
Wedding season, Eid, Ramadan, exam season, winter. A rotating shelf —
*marquees, tailors, jewellers* in wedding season; *iftar deals* in Ramadan —
using data already held. High relevance, near-zero build cost.

---

## Tier 3 — search box specifically

### 13. 🎙️ Voice search in Urdu — probably the single highest-impact item
Typing Roman Urdu on a phone keyboard is slow, and a meaningful share of the
market reads and writes with difficulty. **Speaking is the natural interface
here**, and we already handle Urdu *script* — this closes the loop from the
other side.

Expo has speech recognition; Urdu (`ur-PK`) is supported by the Android
recogniser. Straight into the existing pipeline.

### 14. The placeholder should teach
Today it reads *"Try 'biryani', 'chai', 'pharmacy'…"*, which trains people to
type keywords — so the AI layer we just built will almost never fire. Rotate
through real questions instead:
> *"cheap biryani that delivers"* → *"chemist open now"* → *"salon with parking"*

### 15. Answer before they finish typing
"pharmacy" already has an answer at 4 characters. Show the top result inline
under the box while typing, so simple lookups need no Enter at all.

### 16. Search the map, not just the list
"Show me all pharmacies here" should light up the map. The map already thins
and ranks markers; wiring query results to it is small.

---

## What I'd build first, and why

| | Effort | Why now |
|---|---|---|
| **14. Teaching placeholder** | minutes | The AI feature is invisible without it |
| **13. Urdu voice search** | ~half a day | Biggest reach gain available; nobody local has it |
| **1. Load shedding** | ~1 day | The strongest moat, and instantly explainable in one screenshot |
| **7. "I went" confirm** | ~2 hours | Makes data self-healing; compounds daily |
| **5. Prices from reviews** | ~half a day | Batch job over data already on disk |

The rest are real but sequence behind these.

---

## Deliberately rejected

- **Cashback / coupons** (Savyour occupies this) — needs merchant deals, a
  sales team and a payments stack. Different company.
- **Ordering / delivery** — Foodpanda owns it; we would be a worse Foodpanda.
- **Social feed / following** — moderation burden, and it competes with
  Instagram, which locals already use for exactly this.
- **Gamified badges** — noise, not trust.

Our lane is *knowing the ground truth about places*, and every Tier 1 idea
deepens that instead of diluting it.
