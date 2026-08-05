"""Export a city's enriched data as a compact bundle the app can ship with.

Why this exists: the app must be runnable and demoable before Supabase
credentials exist. The bundle is loaded into on-device SQLite on first launch,
and the app's data layer uses the exact same query shape it will use against
Supabase — so switching to the cloud is a config flip, not a rewrite.

Keeps only what the UI actually renders, and only places worth showing
(rated or verified), newest-first by quality, so the bundle stays small.

Usage: python export_app_data.py <city-slug> [--limit N]
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).parent
APP_ASSETS = ROOT.parent / "app" / "assets" / "data"
DEFAULT_LIMIT = 6000

# The bundle is an OFFLINE SAFETY NET, not a mirror of the hot tier.
#
# Cached reviews were 40 MB of a 77 MB app payload — over half the download —
# to serve a screen that shows exactly ONE review by default and clamps it to
# two lines behind "See more". In a market where install size decides whether
# people install at all, and mobile data is metered, that is the worst trade
# in the project. Two reviews keep the offline detail screen honest (one to
# show, one so "See more" isn't a lie); the cloud serves the full set, which
# is what an online user gets anyway.
BUNDLED_REVIEWS = 2
REVIEW_TEXT_CHARS = 400


def compact_attrs(raw):
    """Emit only what the app's parseFacets() actually reads.

    Google's about-blocks arrive as a JSON *string* of grouped options, and
    the bundle stored that string verbatim: every quote escaped (roughly
    doubling the bytes), every group id and display name carried, every
    DISABLED option carried. parseFacets reads exactly one thing — the names
    of enabled options — and then maps them through a ~25-entry allow-list.

    So: merge to a single block, keep enabled options only, keep just the
    name, and store real JSON rather than an escaped string. parseFacets
    already accepts both shapes (`typeof attributes === 'string' ? JSON.parse
    : attributes`), so this needs no app change.
    """
    try:
        blocks = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(blocks, list):
        return None
    names, seen = [], set()
    for blk in blocks:
        if not isinstance(blk, dict):
            continue
        for opt in blk.get("options") or []:
            if not isinstance(opt, dict) or not opt.get("enabled"):
                continue
            nm = (opt.get("name") or "").strip()
            if nm and nm not in seen:
                seen.add(nm)
                names.append(nm)
    if not names:
        return None
    return [{"options": [{"name": n, "enabled": True} for n in names]}]


def quality(r: dict) -> float:
    """Bayesian-ish prior so a 4.9 with 3 ratings loses to a 4.5 with 900."""
    rating, n = r.get("rating"), r.get("rating_count") or 0
    if rating is None:
        return 0.25 + (0.1 if r.get("state") == "google_matched" else 0)
    return ((n * float(rating)) + (20 * 3.9)) / (n + 20) / 5.0 * (
        1 + min(math.log1p(n) / 12, 0.5))


# ---------------------------------------------------------------- prices --
#
# Google's `$$` is meaningless here; what people trust is what other people
# PAID, and they state it in reviews constantly: "biryani plate 350",
# "cut 500 mein", "Rs. 1200 per head". Mining those gives every reviewed
# place a concrete rupee range no competitor shows.
#
# Only currency-MARKED amounts are taken (Rs/PKR/rupees/rupay//-). Bare
# numbers would drag in years, phone fragments, plot numbers and "5/5".
_P_MARK_BEFORE = re.compile(r"(?:rs\.?|pkr|₨)\s*([\d,]{2,7})(?!\s*(?:%|percent))", re.I)
_P_MARK_AFTER = re.compile(r"\b([\d,]{2,7})\s*(?:rs\b|rupees|rupay|rupaye|pkr|/-)", re.I)
_P_RANGE = re.compile(r"(?:rs\.?|pkr|₨)\s*([\d,]{2,7})\s*(?:-|–|to)\s*([\d,]{2,7})", re.I)

# Menu items to services; outside this it's rent, cars or typos.
_P_MIN, _P_MAX = 30, 50_000


def _amounts(text: str) -> list[int]:
    out = []
    for m in _P_RANGE.finditer(text):
        out += [m.group(1), m.group(2)]
    # Remove range matches before the single-amount passes, or "rs 300-450"
    # yields 300 twice (once from the range, once from the rs-prefix rule).
    rest = _P_RANGE.sub(" ", text)
    out += _P_MARK_BEFORE.findall(rest)
    out += _P_MARK_AFTER.findall(rest)
    vals = []
    for s in out:
        try:
            v = int(s.replace(",", ""))
        except ValueError:
            continue
        if _P_MIN <= v <= _P_MAX:
            vals.append(v)
    return vals


def mine_prices(reviews: list) -> list[int] | None:
    """[lo, hi, n_reviews_mentioning] or None. Middle-heavy on purpose:
    with enough samples the 20th–80th percentile drops the one person who
    mentioned the Rs 40 water bottle and the one who quoted a deal platter."""
    vals: list[int] = []
    n_reviews = 0
    for rv in reviews:
        text = rv.get("text") if isinstance(rv, dict) else None
        if not text:
            continue
        found = _amounts(text)
        if found:
            n_reviews += 1
            vals.extend(found)
    if len(vals) < 2 or n_reviews < 2:
        return None                      # one mention is an anecdote
    vals.sort()
    if len(vals) >= 4:
        # Trim at least one from each end: the Rs 40 water bottle and the
        # Rs 4,500 deal platter are real amounts but not the typical spend.
        cut_lo = max(1, int(len(vals) * 0.2))
        cut_hi = min(len(vals) - 2, int(len(vals) * 0.8))
        lo, hi = vals[cut_lo], vals[cut_hi]
    else:
        lo, hi = vals[0], vals[-1]
    if lo == hi:
        return None                      # a point is not a range worth a row
    if hi > lo * 5:
        # "Rs 3,500–36,000" is not a typical spend, it is two different
        # services mentioned by two different people. Showing it would make
        # the feature read as broken; no range beats a junk range.
        return None
    return [lo, hi, n_reviews]


def main(slug: str, limit: int = DEFAULT_LIMIT) -> None:
    city_dir = ROOT / "out" / slug
    src = city_dir / "enriched.parquet"
    if not src.exists():
        sys.exit(f"{src} missing — nothing scraped/ingested yet for {slug}")

    rows = pq.read_table(src).to_pylist()
    # Only places the UI can render meaningfully.
    usable = [r for r in rows
              if r.get("name") and r.get("lat") and r.get("lng")
              and (r.get("rating") is not None or r.get("state") == "google_matched"
                   or r.get("phone"))]
    usable.sort(key=quality, reverse=True)
    keep = usable[:limit]

    reviews: dict[str, list] = {}
    prices: dict[str, list[int]] = {}
    rp = city_dir / "google_reviews.parquet"
    if rp.exists():
        wanted = {r["id"] for r in keep}
        for r in pq.read_table(rp).to_pylist():
            if r["place_id"] in wanted:
                try:
                    full = json.loads(r["reviews"])
                    # Mine from the FULL cached set before truncating for the
                    # bundle — the 3rd..10th reviews carry prices too.
                    pm = mine_prices(full)
                    if pm:
                        prices[r["place_id"]] = pm
                    revs = full[:BUNDLED_REVIEWS]
                    # Long reviews are the single heaviest thing in the file
                    # and the UI clamps to 2 lines behind a "See more" anyway.
                    for rv in revs:
                        if isinstance(rv, dict) and isinstance(rv.get("text"), str):
                            rv["text"] = rv["text"][:REVIEW_TEXT_CHARS]
                        if isinstance(rv, dict):
                            rv.pop("images", None)   # never rendered offline
                    reviews[r["place_id"]] = revs
                except (json.JSONDecodeError, TypeError):
                    pass

    def slim(r: dict) -> dict:
        out = {
            "id": r["id"],
            "n": r["name"],
            "c": r.get("category_bucket"),
            "gc": r.get("google_category"),
            "lat": round(r["lat"], 6),
            "lng": round(r["lng"], 6),
            "a": r.get("address"),
            "l": r.get("locality"),
            "ph": r.get("phone"),
            "w": r.get("website"),
            # Mostly Facebook pages, and for many small businesses here that
            # page IS their website — menu, prices and messaging all live there.
            "soc": [s for s in (r.get("socials") or []) if s][:2],
            "r": float(r["rating"]) if r.get("rating") is not None else None,
            "rc": r.get("rating_count"),
            "pr": r.get("price_range") or None,
            "h": r.get("hours"),
            "ck": bool(r.get("cards_ok")),
            # Two, not five. A bundled photo URL is a REMOTE fetch — when the
            # user is genuinely offline none of them resolve, so the extra
            # three only serve the narrow "cloud call failed but the network
            # is up" case. One feeds the card thumbnail, the second keeps the
            # detail gallery from being a lone image; the cloud carries the
            # rest. Was the heaviest field in the bundle at 3.5 MB/city.
            "ph_urls": list(r.get("photo_urls") or [])[:2],
            "pm": prices.get(r["id"]),   # [lo, hi, n] mined from review text
            "menu": r.get("menu_url"),
            "order": r.get("order_online_url"),
            "gid": r.get("google_place_id"),
            "st": r.get("state"),
        }
        # Popular times: Google gives {"Monday": {"0": 12, "1": 8, ...}}.
        # Store as 7 arrays of 24 small ints keyed Sun..Sat, which is ~10x
        # smaller than the raw JSON and indexes directly by Date.getDay().
        pt = r.get("popular_times")
        if pt:
            try:
                raw = json.loads(pt) if isinstance(pt, str) else pt
                week = []
                for day in ("Sunday", "Monday", "Tuesday", "Wednesday",
                            "Thursday", "Friday", "Saturday"):
                    hours = raw.get(day) or {}
                    week.append([int(hours.get(str(h), 0)) for h in range(24)])
                if any(any(d) for d in week):
                    out["pt"] = week
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if r.get("rating_histogram"):
            out["hist"] = r["rating_histogram"]
        if r.get("attributes"):
            compact = compact_attrs(r["attributes"])
            if compact:
                out["attr"] = compact
        if r.get("description"):
            out["d"] = r["description"][:280]
        # Freshness, as whole days since epoch (5 chars, not a 25-char ISO
        # stamp × 6000 rows). Absent = seed data we have never seen on Google,
        # which the app must say plainly rather than imply is verified.
        ts = r.get("enriched_at")
        if ts:
            try:
                out["ts"] = int(
                    dt.datetime.fromisoformat(str(ts)).timestamp() // 86400)
            except (ValueError, TypeError, OSError):
                pass
        return {k: v for k, v in out.items() if v not in (None, [], "")}

    bundle = {
        "city": slug,
        "count": len(keep),
        "places": [slim(r) for r in keep],
        "reviews": reviews,
    }

    APP_ASSETS.mkdir(parents=True, exist_ok=True)
    out_path = APP_ASSETS / f"{slug}.json"
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(payload, encoding="utf-8")

    raw_mb = len(payload.encode()) / 1e6
    gz_mb = len(gzip.compress(payload.encode())) / 1e6
    with_r = sum(1 for p in bundle["places"] if p.get("r"))
    with_ph = sum(1 for p in bundle["places"] if p.get("ph_urls"))
    print(f"exported {len(keep):,} places -> {out_path}")
    print(f"  {raw_mb:.1f} MB raw / {gz_mb:.1f} MB gzipped")
    print(f"  {with_r:,} rated | {with_ph:,} with photos | {len(reviews):,} with reviews")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lim = DEFAULT_LIMIT
    if "--limit" in sys.argv:
        lim = int(sys.argv[sys.argv.index("--limit") + 1])
    main(args[0] if args else "faisalabad", lim)
