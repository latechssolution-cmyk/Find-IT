"""City registry. bbox = (min_lon, min_lat, max_lon, max_lat), WGS84.

Boxes are drawn generously around the built-up area + suburbs; the point of
seeding is coverage, and the app's radius search does the real filtering.
"""

CITIES = {
    "faisalabad": {
        "name": "Faisalabad",
        "country": "PK",
        "bbox": (72.90, 31.28, 73.25, 31.58),
        "center": (73.079, 31.418),
    },
    "lahore": {
        "name": "Lahore",
        "country": "PK",
        "bbox": (74.10, 31.30, 74.55, 31.70),
        "center": (74.329, 31.520),
    },
    "islamabad-rawalpindi": {
        "name": "Islamabad / Rawalpindi",
        "country": "PK",
        "bbox": (72.80, 33.42, 73.30, 33.80),
        "center": (73.055, 33.660),
    },
    "karachi": {
        "name": "Karachi",
        "country": "PK",
        "bbox": (66.80, 24.75, 67.40, 25.15),
        "center": (67.030, 24.900),
    },
    "multan": {
        "name": "Multan",
        "country": "PK",
        "bbox": (71.35, 30.10, 71.60, 30.30),
        "center": (71.478, 30.196),
    },
    "peshawar": {
        "name": "Peshawar",
        "country": "PK",
        "bbox": (71.40, 33.94, 71.68, 34.10),
        "center": (71.578, 34.008),
    },
    "quetta": {
        "name": "Quetta",
        "country": "PK",
        "bbox": (66.90, 30.10, 67.10, 30.30),
        "center": (66.996, 30.183),
    },
    "gujranwala": {
        "name": "Gujranwala",
        "country": "PK",
        "bbox": (74.10, 32.10, 74.30, 32.26),
        "center": (74.186, 32.156),
    },
    "sialkot": {
        "name": "Sialkot",
        "country": "PK",
        "bbox": (74.44, 32.44, 74.62, 32.58),
        "center": (74.531, 32.492),
    },
    "hyderabad": {
        "name": "Hyderabad",
        "country": "PK",
        "bbox": (68.28, 25.30, 68.46, 25.45),
        "center": (68.368, 25.396),
    },
    "bahawalpur": {
        "name": "Bahawalpur",
        "country": "PK",
        "bbox": (71.60, 29.33, 71.76, 29.45),
        "center": (71.683, 29.395),
    },
    "sargodha": {
        "name": "Sargodha",
        "country": "PK",
        "bbox": (72.60, 32.02, 72.75, 32.14),
        "center": (72.671, 32.083),
    },
    "sukkur": {
        "name": "Sukkur",
        "country": "PK",
        "bbox": (68.78, 27.65, 68.92, 27.77),
        "center": (68.848, 27.705),
    },
    "abbottabad": {
        "name": "Abbottabad",
        "country": "PK",
        "bbox": (73.18, 34.10, 73.30, 34.22),
        "center": (73.239, 34.155),
    },
    "rahim-yar-khan": {
        "name": "Rahim Yar Khan",
        "country": "PK",
        "bbox": (70.24, 28.36, 70.38, 28.48),
        "center": (70.302, 28.420),
    },
}

# Karachi and everything after it are PAUSED by request (2026-08-05): the
# priority is finishing Lahore completely, then a full cloud + GitHub sync.
# Karachi's checkpoints in scraper/sweeps/karachi/ are intact — restore
# SWEEP_ORDER = SWEEP_ORDER_FULL and restart the supervisor to resume
# exactly where it left off (12 batches done, ~6k rows banked).
SWEEP_ORDER = [
    "faisalabad", "islamabad-rawalpindi", "lahore",
]
SWEEP_ORDER_FULL = [
    "faisalabad", "islamabad-rawalpindi", "lahore", "karachi", "multan",
    "peshawar", "gujranwala", "quetta", "sialkot", "hyderabad", "bahawalpur",
    "sargodha", "sukkur", "abbottabad", "rahim-yar-khan",
]


def get_city(slug: str) -> dict:
    if slug not in CITIES:
        raise KeyError(f"Unknown city '{slug}'. Known: {', '.join(sorted(CITIES))}")
    return {"slug": slug, **CITIES[slug]}
