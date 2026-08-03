"""Dedupe + cross-source matching (PRD §7.6).

The same machinery serves three jobs:
  1. intra-source dedupe (Overture and FSQ both contain internal duplicates)
  2. seed merge (FSQ records matched into the Overture-led canonical set)
  3. later: scraper results matched into canonical (enrich/verify/discover)

Matching rules (deterministic, in priority order):
  - exact normalized-phone match within the H3 neighborhood  -> match
  - trigram(name) >= 0.55 and distance <= 300 m              -> match
  - token_set_ratio >= 90 and distance <= 150 m              -> match
  - trigram(name) in [0.40, 0.55) and distance <= 300 m      -> review queue
  - otherwise                                                -> distinct place

Candidates are only ever drawn from the record's H3 res-9 cell plus its 6
neighbors (~300 m envelope), so the whole thing is O(n * small).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import h3
from rapidfuzz import fuzz

from normalize import (
    haversine_m,
    normalize_name,
    normalize_phone_pk,
    trigram_similarity,
)

H3_RES = 9

MATCH_TRGM = 0.55
REVIEW_TRGM = 0.40
MATCH_DIST_M = 300.0
TOKENSET_RATIO = 90.0
TOKENSET_DIST_M = 150.0

# Intra-source dedupe is stricter: same name-ish, practically same spot.
DEDUPE_TRGM = 0.80
DEDUPE_DIST_M = 100.0


@dataclass
class Place:
    source: str                      # 'overture' | 'fsq' | 'scrape' | ...
    source_id: str
    name: str
    lat: float
    lon: float
    categories: list[str] = field(default_factory=list)
    address: str | None = None
    locality: str | None = None
    postcode: str | None = None
    phone: str | None = None
    website: str | None = None
    email: str | None = None
    socials: list[str] = field(default_factory=list)
    confidence: float | None = None
    extra_ids: dict = field(default_factory=dict)   # {source: source_id}
    merged_from: int = 1

    def __post_init__(self):
        self.norm_name = normalize_name(self.name)
        self.norm_phone = normalize_phone_pk(self.phone)
        self.cell = h3.latlng_to_cell(self.lat, self.lon, H3_RES)


class SpatialIndex:
    """H3 cell -> list of place indices, with disk-1 candidate lookup."""

    def __init__(self):
        self._cells: dict[str, list[int]] = {}
        self.places: list[Place] = []

    def add(self, p: Place) -> int:
        idx = len(self.places)
        self.places.append(p)
        self._cells.setdefault(p.cell, []).append(idx)
        return idx

    def candidates(self, p: Place):
        for cell in h3.grid_disk(p.cell, 1):
            yield from self._cells.get(cell, ())


def _score(a: Place, b: Place) -> tuple[str, float]:
    """Returns (verdict, trgm) where verdict is 'match' | 'review' | 'no'."""
    dist = haversine_m(a.lat, a.lon, b.lat, b.lon)
    if dist > MATCH_DIST_M:
        return "no", 0.0
    if a.norm_phone and b.norm_phone and a.norm_phone == b.norm_phone:
        return "match", 1.0
    trgm = trigram_similarity(a.name, b.name)
    if trgm >= MATCH_TRGM:
        return "match", trgm
    if (
        dist <= TOKENSET_DIST_M
        and a.norm_name
        and b.norm_name
        and fuzz.token_set_ratio(a.norm_name, b.norm_name) >= TOKENSET_RATIO
    ):
        return "match", trgm
    if trgm >= REVIEW_TRGM:
        return "review", trgm
    return "no", trgm


def _merge_into(canon: Place, other: Place) -> None:
    """Fill canon's missing fields from other; record provenance."""
    for attr in ("address", "locality", "postcode", "phone", "website", "email"):
        if not getattr(canon, attr) and getattr(other, attr):
            setattr(canon, attr, getattr(other, attr))
    canon.socials = list(dict.fromkeys([*canon.socials, *other.socials]))
    canon.categories = list(dict.fromkeys([*canon.categories, *other.categories]))
    canon.extra_ids[other.source] = other.source_id
    canon.extra_ids.update(other.extra_ids)
    canon.merged_from += other.merged_from
    canon.norm_phone = normalize_phone_pk(canon.phone)


def dedupe_within(places: list[Place]) -> list[Place]:
    """Intra-source dedupe: keep the richer record, absorb the duplicate.

    Records are processed richest-first (confidence desc, then field count)
    so the survivor is always the best copy.
    """

    def richness(p: Place) -> tuple:
        fields = sum(
            1 for v in (p.address, p.phone, p.website, p.email) if v
        ) + len(p.categories)
        return (p.confidence or 0.0, fields)

    index = SpatialIndex()
    for p in sorted(places, key=richness, reverse=True):
        duplicate_of = None
        for ci in index.candidates(p):
            c = index.places[ci]
            dist = haversine_m(p.lat, p.lon, c.lat, c.lon)
            if dist <= DEDUPE_DIST_M and (
                (p.norm_phone and p.norm_phone == c.norm_phone)
                or trigram_similarity(p.name, c.name) >= DEDUPE_TRGM
            ):
                duplicate_of = c
                break
        if duplicate_of is not None:
            _merge_into(duplicate_of, p)
        else:
            index.add(p)
    return index.places


def match_across(
    canonical: list[Place], incoming: list[Place]
) -> tuple[list[Place], list[dict]]:
    """Match incoming records into canonical.

    Matched incoming records are merged into their canonical counterpart;
    unmatched ones are appended as new canonical places. Borderline pairs
    land in the returned review queue instead of being silently decided.
    """
    index = SpatialIndex()
    for p in canonical:
        index.add(p)

    review_queue: list[dict] = []
    new_count = 0
    for p in incoming:
        best, best_trgm, seen_review = None, -1.0, None
        for ci in index.candidates(p):
            c = index.places[ci]
            verdict, trgm = _score(p, c)
            if verdict == "match" and trgm > best_trgm:
                best, best_trgm = c, trgm
            elif verdict == "review" and seen_review is None:
                seen_review = (c, trgm)
        if best is not None:
            _merge_into(best, p)
        elif seen_review is not None:
            c, trgm = seen_review
            review_queue.append({
                "incoming_source": p.source,
                "incoming_id": p.source_id,
                "incoming_name": p.name,
                "candidate_source": c.source,
                "candidate_id": c.source_id,
                "candidate_name": c.name,
                "trgm": round(trgm, 3),
                "dist_m": round(haversine_m(p.lat, p.lon, c.lat, c.lon), 1),
            })
            index.add(p)  # kept as distinct until a human says otherwise
            new_count += 1
        else:
            index.add(p)
            new_count += 1

    return index.places, review_queue
