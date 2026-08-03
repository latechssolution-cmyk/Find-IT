"""Conform merged places into the canonical serving shape.

v0 category tree: coarse keyword buckets over the raw source labels.
The full ~120-leaf curated tree (PRD open decision #3) replaces the
keyword map later; raw labels are preserved in the output so re-bucketing
never needs a re-slice.
"""

from __future__ import annotations

import uuid

import h3

from match import Place
from normalize import normalize_phone_pk

# uuid5 namespace derived once; deterministic ids across re-runs
_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "findit.app/place")

BUCKETS: list[tuple[str, tuple[str, ...]]] = [
    ("food_drink", ("restaurant", "cafe", "coffee", "tea", "bakery", "fast food",
                    "food", "dessert", "ice cream", "bbq", "pizza", "burger",
                    "biryani", "dining", "snack", "juice", "dhaba")),
    ("groceries", ("grocery", "supermarket", "mart", "general store", "kiryana",
                   "convenience", "fruit", "vegetable", "butcher", "dairy")),
    ("health", ("hospital", "clinic", "doctor", "dentist", "pharmacy", "medical",
                "lab", "laboratory", "physiotherap", "homeopath", "veterinar")),
    ("beauty", ("salon", "saloon", "barber", "parlor", "parlour", "spa", "beauty")),
    ("shopping", ("clothing", "shoe", "boutique", "mall", "market", "jewel",
                  "electronics", "mobile", "furniture", "fabric", "garment",
                  "retail", "shopping", "store")),
    ("auto", ("auto", "car ", "motorcycle", "mechanic", "workshop", "tyre",
              "tire", "fuel", "petrol", "cng", "rickshaw", "spare part")),
    ("services", ("tailor", "laundry", "dry clean", "repair", "printing",
                  "photograph", "courier", "travel agen", "real estate",
                  "property", "lawyer", "notary", "internet", "electrician",
                  "plumb")),
    ("education", ("school", "college", "university", "academy", "tuition",
                   "institute", "library", "madras", "education")),
    ("finance", ("bank", "atm", "exchange", "insurance", "finance", "microfinance")),
    ("fitness", ("gym", "fitness", "sports", "cricket", "stadium", "club",
                 "swimming")),
    ("lodging", ("hotel", "guest house", "hostel", "motel", "lodging")),
    ("religious", ("mosque", "masjid", "church", "temple", "shrine", "religious")),
    ("entertainment", ("cinema", "park", "amusement", "arcade", "event",
                       "wedding", "marquee", "banquet")),
    ("government", ("government", "police", "post office", "court", "office",
                    "union council", "wapda", "nadra")),
]


def bucket_for(labels: list[str]) -> str:
    joined = " | ".join(labels).lower()
    for bucket, needles in BUCKETS:
        if any(n in joined for n in needles):
            return bucket
    return "other"


def to_canonical_rows(places: list[Place], city_slug: str) -> list[dict]:
    rows = []
    for p in places:
        source_ids = {p.source: p.source_id, **p.extra_ids}
        canonical_id = str(uuid.uuid5(
            _NAMESPACE, source_ids.get("overture") or source_ids.get("fsq") or f"{p.source}:{p.source_id}"
        ))
        rows.append({
            "id": canonical_id,
            "gers_id": source_ids.get("overture"),
            "fsq_id": source_ids.get("fsq"),
            "google_place_id": None,          # filled by scraper matching (T1)
            "name": p.name,
            "category_bucket": bucket_for(p.categories),
            "categories_raw": p.categories,
            "address": p.address,
            "locality": p.locality,
            "postcode": p.postcode,
            "city": city_slug,
            "phone": normalize_phone_pk(p.phone),
            "phone_raw": p.phone,
            "website": p.website,
            "email": p.email,
            "socials": p.socials,
            "lat": p.lat,
            "lng": p.lon,
            "h3_9": h3.latlng_to_cell(p.lat, p.lon, 9),
            "confidence": p.confidence,
            "state": "seed_only",             # PRD §7.6 lifecycle
            "sources": sorted(source_ids),
            "merged_from": p.merged_from,
        })
    return rows
