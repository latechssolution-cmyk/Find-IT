"""Fold scraper output into a city's canonical database (PRD §7.6).

One pass does all three jobs:
  ENRICH   scrape row matched to a canonical place -> rating, hours, photos,
           Google ids, attributes; state -> google_matched
  VERIFY   every matched canonical row gets seen_at stamped; rows never seen
           across sweeps accumulate misses (caller decides when to demote)
  DISCOVER scrape rows with no canonical match -> inserted as google_only

Google reviews are written to a SEPARATE bounded store (top 10/place,
replaced not appended) per the PRD's review-cache rule — never into the
place table.

Usage: python ingest_scrape.py <city-slug> [scrape_dir]
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import pyarrow as pa
import pyarrow.parquet as pq

from conform import bucket_for
from match import Place, SpatialIndex, _score
from normalize import normalize_phone_pk

OUT = Path(__file__).parent / "out"
MAX_REVIEWS_PER_PLACE = 10
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def compact_hours(open_hours: dict | None) -> str | None:
    """{'Monday': ['9 AM-10 PM'], ...} -> 'mo:9 AM-10 PM|tu:...' (~40-90 B)."""
    if not open_hours:
        return None
    parts = []
    for day in DAYS:
        slots = open_hours.get(day)
        if slots:
            parts.append(f"{day[:2].lower()}:{','.join(slots)}")
    return "|".join(parts) or None


def scrape_to_place(r: dict) -> Place | None:
    if not r.get("title") or r.get("latitude") is None or r.get("longitude") is None:
        return None
    cid = r.get("cid") or r.get("place_id") or r.get("data_id")
    if not cid:
        return None
    addr = r.get("complete_address") or {}
    return Place(
        source="scrape",
        source_id=str(cid),
        name=str(r["title"]),
        lat=float(r["latitude"]),
        lon=float(r["longitude"]),
        categories=[c for c in (r.get("categories") or []) if c],
        address=r.get("address") or None,
        locality=(addr.get("borough") or addr.get("city")) or None,
        postcode=addr.get("postal_code") or None,
        phone=r.get("phone") or None,
        website=r.get("web_site") or None,
        email=(r.get("emails") or [None])[0],
    )


def _json_or_none(v) -> str | None:
    """Rich nested structures (about/popular_times/owner/histogram) are stored
    as compact JSON strings — parquet-friendly and schema-stable."""
    if not v:
        return None
    if isinstance(v, str):
        return v or None
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _unwrap(url: str) -> str:
    """Google wraps outbound links as /url?q=<real>&opi=... — unwrap them."""
    if url.startswith(("/url?", "http://www.google.com/url?",
                       "https://www.google.com/url?")):
        q = parse_qs(urlparse(url).query).get("q")
        if q:
            return unquote(q[0])
    return url


def _link(v) -> str | None:
    """menu/order_online/reservations come as {'link':..,'source':..} or str."""
    if not v:
        return None
    if isinstance(v, dict):
        u = v.get("link") or v.get("url")
        return _unwrap(u) if u else None
    if isinstance(v, list):
        for item in v:
            u = _link(item)
            if u:
                return u
        return None
    return _unwrap(str(v)) or None


def _photo_urls(r: dict, limit: int = 3) -> list[str]:
    urls = []
    if r.get("thumbnail"):
        urls.append(r["thumbnail"])
    for img in (r.get("images") or []):
        u = img.get("image") if isinstance(img, dict) else None
        if u and u not in urls:
            urls.append(u)
        if len(urls) >= limit:
            break
    return urls[:limit]


def _reviews(r: dict) -> list[dict]:
    """Bounded cache, newest/most-helpful first (PRD §2.4). Merges the
    standard and -extra-reviews payloads, de-duped by author+text."""
    out, seen = [], set()
    for src in ("user_reviews", "user_reviews_extended"):
        for rv in (r.get(src) or []):
            if not isinstance(rv, dict) or len(out) >= MAX_REVIEWS_PER_PLACE:
                continue
            text = (rv.get("Description") or rv.get("description") or "")
            author = rv.get("Name") or rv.get("name")
            key = (author, text[:60])
            if key in seen or not (text or author):
                continue
            seen.add(key)
            out.append({
                "author": author,
                "rating": rv.get("Rating") or rv.get("rating"),
                "text": text[:1200],
                "when": rv.get("When") or rv.get("when"),
                "images": rv.get("Images") or None,
            })
    return out


def load_scrape_rows(scrape_dir: Path) -> list[dict]:
    """Batch results only — plan.json/state.json live in the same directory."""
    rows, seen = [], set()
    for f in sorted(scrape_dir.glob("b*.json")):
        for line in f.open(encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(r, dict):
                continue
            key = r.get("cid") or r.get("place_id") or r.get("data_id")
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append(r)
    return rows


def main(slug: str, scrape_dir: Path | None = None) -> dict:
    city_dir = OUT / slug
    canonical_path = city_dir / "canonical.parquet"
    if not canonical_path.exists():
        sys.exit(f"{canonical_path} missing — run: python run_city.py {slug}")
    scrape_dir = scrape_dir or (Path(__file__).parent.parent / "scraper" / "sweeps" / slug)
    if not scrape_dir.exists():
        sys.exit(f"{scrape_dir} missing — nothing scraped yet")

    canon_rows = pq.read_table(canonical_path).to_pylist()
    scrape_rows = load_scrape_rows(scrape_dir)
    now = datetime.now(timezone.utc).isoformat()
    print(f"[ingest] {len(canon_rows):,} canonical rows | {len(scrape_rows):,} unique scraped places")

    # Spatial index over canonical rows, addressed by list position.
    index = SpatialIndex()
    for row in canon_rows:
        index.add(Place(
            source="canonical",
            source_id=row["id"],
            name=row["name"],
            lat=row["lat"],
            lon=row["lng"],
            phone=row.get("phone_raw") or row.get("phone"),
        ))

    by_id = {r["id"]: r for r in canon_rows}
    enriched = discovered = 0
    reviews_out: list[dict] = []
    new_rows: list[dict] = []

    for r in scrape_rows:
        p = scrape_to_place(r)
        if p is None:
            continue
        best, best_trgm = None, -1.0
        for ci in index.candidates(p):
            c = index.places[ci]
            verdict, trgm = _score(p, c)
            if verdict == "match" and trgm > best_trgm:
                best, best_trgm = c, trgm

        payload = {
            "google_place_id": r.get("place_id") or None,
            "google_cid": str(r["cid"]) if r.get("cid") else None,
            "google_data_id": r.get("data_id") or None,
            "rating": r.get("review_rating") or None,
            "rating_count": r.get("review_count") or None,
            "hours": compact_hours(r.get("open_hours")),
            "photo_urls": _photo_urls(r, limit=8),
            "price_range": r.get("price_range") or None,
            "cards_ok": bool(r.get("credit_cards_accepted")),
            "google_category": r.get("category") or None,
            # --- full detail set (PRD: "everything scrapable") ---
            "description": r.get("description") or None,
            "attributes": _json_or_none(r.get("about")),        # amenities/services
            "menu_url": _link(r.get("menu")),
            "order_online_url": _link(r.get("order_online")),
            "reservations_url": _link(r.get("reservations")),
            "popular_times": _json_or_none(r.get("popular_times")),
            "rating_histogram": _json_or_none(r.get("reviews_per_rating")),
            "owner": _json_or_none(r.get("owner")),
            "plus_code": r.get("plus_code") or None,
            "street_view_url": r.get("street_view_url") or None,
            "timezone": r.get("timezone") or None,
            "google_status": r.get("status") or None,
            "reviews_link": r.get("reviews_link") or None,
            "maps_link": r.get("link") or None,
            "enriched_at": now,
            "seen_at": now,
        }

        if best is not None:
            row = by_id[best.source_id]
            row.update(payload)
            row["state"] = "google_matched"
            if not row.get("phone") and r.get("phone"):
                row["phone"] = normalize_phone_pk(r["phone"])
                row["phone_raw"] = r["phone"]
            if not row.get("website") and r.get("web_site"):
                row["website"] = r["web_site"]
            if not row.get("address") and r.get("address"):
                row["address"] = r["address"]
            enriched += 1
            target_id = row["id"]
        else:
            cats = p.categories or ([r["category"]] if r.get("category") else [])
            row = {
                "id": f"g_{p.source_id}",
                "gers_id": None, "fsq_id": None,
                "name": p.name,
                "category_bucket": bucket_for(cats),
                "categories_raw": cats,
                "address": p.address, "locality": p.locality, "postcode": p.postcode,
                "city": slug,
                "phone": normalize_phone_pk(p.phone), "phone_raw": p.phone,
                "website": p.website, "email": p.email, "socials": [],
                "lat": p.lat, "lng": p.lon, "h3_9": p.cell,
                "confidence": None,
                "state": "google_only",
                "sources": ["scrape"], "merged_from": 1,
                **payload,
            }
            new_rows.append(row)
            # Index under the ROW id: a later scrape row matching this one must
            # resolve back through by_id, so both keys have to agree.
            p.source_id = row["id"]
            index.add(p)          # so later duplicates in the sweep collapse
            by_id[row["id"]] = row
            discovered += 1
            target_id = row["id"]

        revs = _reviews(r)
        if revs:
            reviews_out.append({
                "place_id": target_id,
                "google_cid": payload["google_cid"],
                "reviews": json.dumps(revs, ensure_ascii=False),
                "fetched_at": now,
            })

    all_rows = canon_rows + new_rows
    # Uniform schema: every row carries every key.
    keys = set().union(*(r.keys() for r in all_rows))
    for r in all_rows:
        for k in keys - r.keys():
            r[k] = None

    pq.write_table(pa.Table.from_pylist(all_rows),
                   city_dir / "enriched.parquet", compression="zstd")
    if reviews_out:
        pq.write_table(pa.Table.from_pylist(reviews_out),
                       city_dir / "google_reviews.parquet", compression="zstd")

    verified = sum(1 for r in all_rows if r.get("state") == "google_matched")
    unverified = sum(1 for r in all_rows if r.get("state") == "seed_only")
    stats = {
        "city": slug,
        "canonical_before": len(canon_rows),
        "scraped_unique": len(scrape_rows),
        "enriched": enriched,
        "discovered": discovered,
        "total_after": len(all_rows),
        "verified_google_matched": verified,
        "still_seed_only": unverified,
        "with_reviews": len(reviews_out),
        "ingested_at": now,
    }
    (city_dir / "ingest_stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    print(f"[ingest] enriched {enriched:,} | discovered {discovered:,} new | "
          f"total {len(all_rows):,} | reviews for {len(reviews_out):,} places")
    print(f"[ingest] verified {verified:,} | still unverified {unverified:,}")
    return stats


if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "faisalabad"
    sd = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    main(slug, sd)
