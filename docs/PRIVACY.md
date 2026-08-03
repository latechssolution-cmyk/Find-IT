# FIND IT — Privacy Policy

**Last updated: 4 August 2026**

FIND IT helps you find local businesses in Pakistan. This policy describes
exactly what the app does with data. It is written to match the app's real
behaviour, not to cover every hypothetical.

> **Draft — needs a lawyer's review before publication.** It is accurate to
> the build as of 4 Aug 2026 and must be re-checked whenever data handling
> changes (notably: enabling accounts, analytics, or ads — see *Things that
> would change this policy* at the end).

---

## The short version

- We do not ask you to create an account, and we do not know who you are.
- Your location is used to find places near you. It is **never** collected in
  the background, and never stored on our servers.
- Your saved places, your reviews and your settings live **on your device**.
- We do not sell data. We do not run ads. We do not use third-party analytics
  or tracking SDKs.

---

## What the app collects, and why

### Location — used, not stored

FIND IT asks for location permission so it can show places near you.

- **Permission requested:** approximate (`ACCESS_COARSE_LOCATION`) and precise
  (`ACCESS_FINE_LOCATION`) location, **while the app is in use only**.
- **Background location is not requested.** The permission is explicitly
  blocked in the app's manifest, so the app cannot access your location when
  it is closed or in the background — even in future versions, unless this
  policy changes first.
- **How it is used:** your coordinates are sent with a search request to our
  database so it can return places within your chosen radius, and to sort
  results by distance.
- **How long we keep it:** we do not. Coordinates are used to answer the
  request and are not written to our database or logs as personal records.
- **You can decline.** The app works fully without location permission — pick
  any point on the map instead. Declining is a supported path, not a
  degraded one.

### What stays on your device only

None of the following leaves your phone in the current version:

| Data | Purpose |
|---|---|
| Saved places | Your bookmarks, available offline |
| Your reviews (rating, tags, text) | Written but not yet published |
| Reports ("this place has closed") | Queued for a future correction service |
| Recent searches | Search suggestions |
| Appearance setting | Light / dark / automatic |
| Usage events (screens opened, filters used) | Product improvement |

Usage events are capped at the 500 most recent, contain no free text from
your searches — only the *length* of a query and the number of results — and
never contain your coordinates. They are stored locally and are not currently
transmitted anywhere.

**Uninstalling the app deletes all of it.** There is no server copy to
request, because none was ever created.

### What we receive

Our database (Supabase, hosted in Mumbai, India) receives:

- The **coordinates and radius** of your search, to answer it.
- The **place identifiers** you open, to return that place's details.

These arrive as ordinary web requests. Your IP address is visible to our
hosting provider in the course of routing them, as it is for any website.
We do not join that to any profile, because we have no profile to join it to.

---

## Where the place information comes from

The businesses shown in FIND IT are compiled from:

- **Overture Maps Foundation** data (CDLA-Permissive 2.0)
- **Foursquare Open Source Places** (Apache 2.0)
- Publicly visible business information from Google Maps, including ratings
  and reviews, which are shown **labelled as Google's** and separately from
  reviews written in FIND IT

Business information is not personal data about *you*. If you are a business
owner and want a listing corrected or removed, see *Contact* below.

Places we have not independently verified are labelled **"From public map
data · not yet verified"** in the app, so you can judge them accordingly.

---

## What we do not do

- We do not sell or rent data to anyone.
- We do not show ads, and we do not include any advertising SDK.
- We do not include Google Analytics, Firebase Analytics, Facebook SDK, or
  any comparable third-party tracking library.
- We do not use your advertising identifier.
- We do not track you across other apps or websites.
- We do not access your contacts, camera, microphone, photos, files, SMS or
  call logs. The app does not request those permissions.

---

## Children

FIND IT is intended for users aged 13 and over. It is not directed at
children, and we do not knowingly collect data from children under 13. If you
believe a child has provided us with data, contact us and we will delete it.

---

## Your choices

- **Location:** revoke it any time in Android Settings → Apps → FIND IT →
  Permissions. The app continues to work with a manually chosen location.
- **Saved places, reviews, history:** clear them in the app, or uninstall to
  remove everything at once.
- **Requests about data:** contact us at the address below.

---

## Security

Traffic between the app and our database uses HTTPS. Our database enforces
row-level security so the app's public key can read place information and
nothing else. The keys shipped inside the app are designed to be public and
grant read-only access.

---

## Changes to this policy

If data handling changes materially — in particular if we add accounts,
analytics, or advertising — this policy will be updated before the change
ships, and the "Last updated" date above will change.

---

## Contact

**Email:** _[TO BE FILLED IN — a monitored address is required by Google Play
and must appear both here and on the Play listing]_

For business owners requesting a correction or removal of a listing, please
include the business name and location.

---

## Things that would change this policy

Recorded here so this document is updated at the same time as the code:

1. **Enabling Supabase anonymous auth** (the code is written but the provider
   is disabled). This creates a per-device account identifier and syncs your
   reviews and saved places to the server — which then requires an **in-app
   account deletion path and a public web deletion form** under Google Play
   policy, plus a rewrite of the "stays on your device" section above.
2. **Adding analytics or crash reporting** (e.g. Sentry). Crash reports
   contain device model, OS version and a stack trace; that must be declared
   in the Data Safety form and described here.
3. **Adding advertising.** An ad SDK collects identifiers and requires
   substantial additions, including consent handling in some regions.
4. **Launching in the EU/UK.** Adds GDPR obligations: a stated lawful basis,
   data subject rights, and a representative in some cases.
