# FIND IT — Play Store production-readiness audit

Researched against Google's live policy pages on **3 August 2026**. Every
policy claim below links its source. Re-check anything within ~30 days of
submitting: these pages change often.

## App context used

| | |
|---|---|
| App | FIND IT — local business discovery for Pakistan |
| Stack | Expo SDK 57 / React Native 0.86, New Architecture, Hermes |
| Package | `pk.findit.app`, version 0.1.0, never published |
| Category | Maps & Navigation (or Travel & Local) |
| Backend | Supabase (Postgres + PostgREST), `ap-south-1` Mumbai |
| Permissions | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`. Background location **explicitly blocked** in `app.json` |
| Accounts | None today. Anonymous Supabase auth wired but provider disabled |
| UGC | Yes — user reviews (stars + tags + free text) and one-tap reports |
| Stated launch intent | **Ads (AdMob) + paid features + audience including under-13** |

---

# Executive summary

**Verdict: not ready — and one stated choice should be reconsidered before
any engineering work happens.**

### 🔴 The under-13 decision is the whole audit

You selected *"Everyone including under 13"*. Combined with AdMob and user
reviews, that is the single most consequential choice here, and I'd push back
on it before you build anything.

Declaring a child audience puts FIND IT under the
[Families policy](https://support.google.com/googleplay/android-developer/answer/9893335),
which for **this** app means:

1. **Ads get much harder.** Only SDKs in the
   [Families Self-Certified Ads SDK Program](https://support.google.com/googleplay/android-developer/answer/9900633)
   may serve to children, personalized ads and remarketing must be off, and
   the advertising ID cannot be collected from children. Your effective CPM
   drops substantially — non-personalized ads in Pakistan earn very little.
2. **Reviews become a child-safety surface.** FIND IT carries user-generated
   content, so the
   [Child Safety Standards policy](https://support.google.com/googleplay/android-developer/answer/14747720)
   applies: published anti-CSAE standards, an in-app reporting mechanism, a
   designated safety contact, and a documented moderation process. You
   currently have no moderation pipeline at all — reviews are stored locally
   and sync unmoderated.
3. **The core product is arguably adult-shaped.** The app's primary actions
   are *call this business*, *open WhatsApp to a stranger*, and *navigate
   here*. Reviewers assess whether a child audience is plausible; an app whose
   main verbs are "phone a shop" and "message a stranger" invites scrutiny you
   gain nothing from.
4. **Location from children is a sensitive-data problem**, not just a form to
   fill in.

**Recommendation: declare 13+ / general audience.** You lose nothing real —
under-13s are not a meaningful market for local business discovery in
Pakistan — and you delete an entire compliance surface, keep personalized ad
revenue, and avoid the moderation build. If you have a specific reason for
under-13, tell me and I'll rework the audit around it; it is buildable, just
much more expensive.

*Everything below assumes **13+ general audience**. Sections that change under
a child audience are marked ⚠️ FAMILIES.*

### Top 5 risks for this app

| # | Risk | Severity |
|---|---|---|
| 1 | **Target API 36 deadline is 4 weeks away** (31 Aug 2026) | 🔴 BLOCKER |
| 2 | **Under-13 declaration** pulls in Families + Child Safety Standards | 🔴 BLOCKER (if kept) |
| 3 | **Personal account 12-tester / 14-day gate** — adds 2+ weeks | 🔴 BLOCKER (if personal) |
| 4 | **Scraped Google data + "on Google" labelling** — IP/misrepresentation exposure | 🟠 HIGH |
| 5 | **No crash/ANR reporting** — vitals problems land invisibly | 🟠 HIGH |

---

# Phase 1 — Compliance matrix

| Requirement | Applies? | Status | Action | Source |
|---|---|---|---|---|
| **Target API 36 (Android 16) for new apps from 31 Aug 2026** | Yes | ✅ **FIXED 4 Aug** | Expo SDK 57 defaulted to **35**, not 36 — confirmed by reading `ExpoRootProjectPlugin.kt` (`getVersionOrDefault("targetSdk", "35")`) and by generating the native project, which carried no version catalog to override it. This app **would have been rejected**. Pinned via `expo-build-properties`; `expo prebuild` now emits `android.targetSdkVersion=36` | [Target API levels](https://support.google.com/googleplay/android-developer/answer/11926878) |
| **App Bundle (.aab), 64-bit, Play App Signing** | Yes | ✅ likely pass | `eas build --platform android` produces a compliant AAB by default. Verify 64-bit libs present | [Play Console](https://support.google.com/googleplay/android-developer/answer/9859152) |
| **16 KB page size compatibility** | Yes | ⚠️ UNVERIFIED | RN 0.86 + Expo 57 native libs should be compliant; verify with the Play Console pre-launch report | [Android docs](https://developer.android.com/guide/practices/page-sizes) |
| **Privacy policy, publicly hosted** | Yes | ❌ FAIL | None exists. Must cover: location use, review content, analytics, Supabase as processor, deletion route. Host at a stable URL | [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) |
| **Data safety form** | Yes | ❌ FAIL | Declare: approximate + precise location (app functionality, not shared), user-generated content (reviews), device identifiers if any analytics added. You currently ship **no third-party SDK that collects data** — that is a genuine advantage, keep it true | [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) |
| **Account deletion (in-app + web URL)** | Only if accounts | ⚪ N/A today | You have no accounts. If you enable Supabase anonymous auth for review sync, this becomes mandatory: an in-app delete path **and** a publicly reachable web form | [Deletion policy](https://support.google.com/googleplay/android-developer/answer/13327111) |
| **Foreground location** | Yes | ✅ pass | Coarse + fine only, background explicitly blocked in `app.json`. No declaration form needed. Keep the prominent-disclosure primer you already have in onboarding | [Location permissions](https://support.google.com/googleplay/android-developer/answer/9799150) |
| **Background location declaration** | No | ⚪ N/A | `ACCESS_BACKGROUND_LOCATION` is in `blockedPermissions`. This avoids the hardest permission review on Play — do not regress it | — |
| **Content rating (IARC)** | Yes | ❌ TODO | Answer honestly, including that the app has UGC. Misdeclaring is a suspension risk | [Ratings](https://support.google.com/googleplay/android-developer/answer/9859655) |
| **Child Safety Standards** | ⚠️ FAMILIES / UGC | ❌ TODO | Required for social/UGC apps. Publish anti-CSAE standards, provide reporting, name a safety contact | [Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720) |
| **Families Self-Certified Ads SDK** | ⚠️ FAMILIES only | ⚪ N/A at 13+ | Under-13 forces certified SDKs + non-personalized ads only | [Families ads](https://support.google.com/googleplay/android-developer/answer/9900633) |
| **Play Billing for digital goods** | Only if paid features | ⚪ N/A today | If you sell in-app (e.g. business listings upgrades), Play Billing is mandatory for *digital* goods. Selling **physical** services or ads to businesses is out of scope for Billing | [Payments](https://support.google.com/googleplay/android-developer/answer/9858738) |
| **12 testers × 14 days closed testing** | If personal account created after 13 Nov 2023 | ⚠️ UNKNOWN | You didn't specify account type. If personal-new: recruit 12 real testers, keep them opted in 14 continuous days, then apply for production | [Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) |
| **GDPR / UK GDPR** | Only if EU/UK launch | ⚪ likely N/A | Pakistan-only launch avoids this entirely. Worldwide launch adds lawful basis, consent for analytics, DSA trader declaration | — |

---

# Phase 2 — Rejection & suspension risks, ranked for FIND IT

### 🔴 1. Scraped Google data and how you label it
This is your most under-appreciated risk and it is specific to this app.

- You display Google review text, author names and ratings, labelled *"on
  Google"* and *"Details from Google"*. That labelling is honest and helps,
  but redistributing Google Maps content is **contrary to Google Maps
  Platform Terms**, and Play enforcement sits inside the same company.
- **Mitigations, in order of strength:** (a) drop cached Google review *text*
  and keep only your own reviews plus aggregate counts; (b) keep review text
  but shorten to a snippet with clear attribution and a link out; (c) migrate
  enrichment to a licensed source.
- Your open-data spine (Overture CDLA-Permissive, Foursquare Apache-2.0) is
  clean and properly attributed — that part is fine.

### 🟠 2. Minimum functionality / "webview wrapper"
Not a real risk. FIND IT has 100k+ places, offline data, real search. Fine.

### 🟠 3. Metadata
- Do **not** keyword-stuff the title. `FIND IT — Local businesses in Pakistan`
  is safe; `FIND IT: Best Restaurants Shops Salons Near Me Pakistan` is not.
- Screenshots must show the real app. No mocked-up device frames with claims
  the app doesn't deliver.

### 🟠 4. Broken functionality at review time
Reviewers test on a real device, often on a poor network, in a country you
didn't expect. Your `ResilientSource` fallback is a genuine asset here — the
app degrades to bundled data rather than showing an empty screen.

### 🟡 5. Impersonation
`pk.findit.app` and the name "FIND IT" are generic enough to be safe. Do not
use Google's marks in the icon, feature graphic or screenshots.

---

# Phase 3 — Technical quality, specific to Expo/RN

### Android vitals
Google's bad-behaviour thresholds: **user-perceived crash rate ≥ 1.09%** and
**user-perceived ANR rate ≥ 0.47%** trigger reduced discoverability.
([Vitals](https://support.google.com/googleplay/android-developer/answer/9844486))

### 🔴 No crash reporting is your biggest technical gap
You currently ship **no crash or ANR reporting**. If vitals degrade after
launch you will learn from a Play Console warning, not from telemetry.
- **Recommended: Sentry** (`@sentry/react-native`) over Crashlytics for this
  stack — it symbolicates Hermes stack traces well and doesn't drag in the
  whole Firebase SDK, which would also add a data-collection disclosure you
  currently don't need.

### What today's work already covers
Genuinely strong for a pre-launch app, and worth not regressing:
- **Error boundaries** — `ScreenError` (any screen) and `MapBoundary` (WebGL),
  both verified by forcing real failures. A crash costs a screen, not the app.
- **Offline path** — bundled 6,000-place slice per city with automatic
  fallback, plus one retry against transient cloud timeouts.
- **Dark mode** — verified across all screens.
- **Accessibility** — composed screen-reader labels on cards, 44px touch
  targets via measured `hitSlop`, WCAG contrast verified at 0 failures across
  379 rendered nodes in both themes.

### Gaps to close
| Item | Severity |
|---|---|
| No crash/ANR reporting | 🔴 |
| No release-build (`eas build --profile production`) smoke test yet — Hermes + minification differ from dev | 🟠 |
| **RTL not verified.** Urdu is RTL and you render Urdu place names today | 🟠 |
| Process-death restoration untested (Android kills backgrounded apps aggressively on Xiaomi/Oppo, both huge in Pakistan) | 🟠 |
| 39.9 MB bundle → low-RAM device testing needed | 🟡 |
| No baseline profile | 🟢 |

---

# Phase 4 — Launch plan

### Week 1 — blockers
1. **Decide the audience question.** Everything else depends on it.
2. **Pin and verify `targetSdkVersion 36`** — add `expo-build-properties`,
   run `eas build`, confirm in the Play Console. *Deadline 31 Aug 2026.*
3. **Write the privacy policy**, host it publicly, link it in `app.json` and
   the listing.
4. **Create the developer account** and start the 12-tester clock immediately
   if it's a personal account — that 14-day window runs in parallel with
   everything else, so start it first.
5. **Resolve the Google review-text question** (Phase 2, item 1).

### Week 2 — quality
6. Add Sentry; set a launch-week alert threshold.
7. Production release build; test on a real low-end Android device.
8. Verify RTL with Urdu content.
9. Complete Data Safety + IARC questionnaires.
10. Prepare listing assets: icon, feature graphic (1024×500), ≥4 phone
    screenshots, short + full description.

### Rollout
Internal → closed (satisfies the tester rule) → production at **20% staged
rollout**. Halt if crash rate exceeds 1% or ANR exceeds 0.4%; advance to 50%
then 100% over ~5 days if vitals hold.

---

# Consolidated go/no-go checklist

### 🔴 Blockers
- [ ] Audience decision (13+ strongly recommended)
- [x] ~~`targetSdkVersion 36`~~ — pinned and verified in the generated
      project on 4 Aug. Re-confirm once in the Play Console on first upload
- [ ] Privacy policy written and hosted
- [ ] Data Safety form completed
- [ ] IARC content rating completed
- [ ] Developer account created; 12-tester clock started if personal
- [ ] Google review-text redistribution resolved
- [ ] If accounts enabled: in-app + web account deletion

### 🟠 High
- [ ] Sentry integrated, alerting configured
- [ ] Production build smoke-tested on a physical low-end device
- [ ] RTL verified with Urdu names
- [ ] Process-death / state restoration checked
- [ ] Pre-launch report reviewed
- [ ] Child Safety Standards published (UGC app)

### 🟡 Polish
- [x] ~~Launcher icon~~ — was Expo's **default blue chevron** on a leftover
      coral `#FF5A3C`, i.e. a template placeholder on the most-seen brand
      surface there is. Replaced 4 Aug with a cream pin on brand chocolate
      (`scripts/make-icons.py`, generated from the design tokens). **Still
      worth a designer's pass** — it is a competent generic mark, not a
      distinctive one, and a plain pin sits close to Maps iconography
- [ ] Store listing copy and screenshots
- [ ] Low-RAM device pass
- [ ] Baseline profile

---

## Where I'd stop and ask

1. **Under-13** — I recommend against it and would like a decision before you
   invest in Families compliance.
2. **Ads + paid features "at launch"** — both add real surface. Launching free
   and adding monetization in v1.1 is materially lower risk.
3. **Account type** — unanswered, and it decides whether launch is ~2 or ~4
   weeks out.
