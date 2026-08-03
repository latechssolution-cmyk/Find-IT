"""Normalization + similarity primitives shared by dedupe and matching.

trigram_similarity mirrors pg_trgm semantics (word padding + Jaccard) so
thresholds tuned here transfer directly to the Postgres serving layer.
"""

from __future__ import annotations

import math
import re
import unicodedata

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")

# Tokens that carry no identity signal in PK business names.
_NOISE_TOKENS = frozenset({
    "the", "and", "of", "&",
    "shop", "store", "center", "centre", "official",
})


def normalize_name(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).casefold()
    s = _PUNCT_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def name_tokens(s: str | None) -> list[str]:
    return [t for t in normalize_name(s).split() if t not in _NOISE_TOKENS]


def trigrams(s: str | None) -> frozenset[str]:
    """pg_trgm-style trigrams: each word padded with two leading and one
    trailing space before extracting character 3-grams."""
    grams: set[str] = set()
    for word in normalize_name(s).split():
        padded = f"  {word} "
        grams.update(padded[i : i + 3] for i in range(len(padded) - 2))
    return frozenset(grams)


def trigram_similarity(a: str | None, b: str | None) -> float:
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return inter / (len(ta) + len(tb) - inter)


def normalize_phone_pk(raw: str | None) -> str | None:
    """Canonicalize Pakistani phone numbers to '92XXXXXXXXXX' digits.

    Handles +92..., 0092..., 041-1234567 (city landline), 0300-1234567.
    Returns None when fewer than 9 significant digits remain.
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("0092"):
        digits = "92" + digits[4:]
    elif digits.startswith("92") and len(digits) >= 11:
        pass
    elif digits.startswith("0"):
        digits = "92" + digits[1:]
    if len(digits) < 11:  # 92 + at least 9 national digits
        return None
    return digits[:14]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
