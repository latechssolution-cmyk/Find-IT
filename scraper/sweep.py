"""Autonomous multi-city sweep supervisor (PRD §7.6 T1 enrichment).

Runs forever until every city in SWEEP_ORDER is fully swept, then keeps
cycling to pick up anything that failed. Designed to be killed at any moment:

  * single-instance lock  — two supervisors racing on the same files was a
    real bug; a stale lock (dead PID) is reclaimed automatically
  * per-batch checkpoint  — state.json records finished batches; rerun resumes
  * atomic batch output   — tmp + rename, so a crash costs one batch
  * no permanent give-up  — a city that throws is retried on the next cycle
  * child output to FILES — piping gmaps' per-job logs deadlocks it on Windows

Full-detail extraction is on: -extra-reviews pulls the deeper review payload,
and the ingest keeps menus, attributes, popular times and rating histograms.

Run:  python -u sweep.py            (all cities, in order)
      python -u sweep.py lahore     (one city)
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "pipeline"))
from cities import SWEEP_ORDER, get_city      # noqa: E402
import ingest_scrape                          # noqa: E402

HERE = Path(__file__).parent
EXE = HERE / "gmaps.exe"
SWEEPS = HERE / "sweeps"
LOCK = SWEEPS / "supervisor.lock"
CATEGORIES = [c.strip() for c in (HERE / "categories.txt").read_text(encoding="utf-8").splitlines() if c.strip()]

GRID_KM = 4.0
ZOOM = 14
CONCURRENCY = 4
DEPTH = 2
CATS_PER_BATCH = 4
BATCH_TIMEOUT_S = 2700
# Below this, a zero-row batch means no search ran (error), not an empty area.
# Real batches take 300–2700s; the fastest legitimate one observed was ~400s.
NO_SEARCH_S = 90
INACTIVITY = "4m"
INGEST_EVERY = 10
MAX_CYCLES = 100


def log(msg: str) -> None:
    print(f"[{time.strftime('%m-%d %H:%M:%S')}] {msg}", flush=True)
    try:                       # a second copy that survives stdout weirdness
        with (SWEEPS / "progress.log").open("a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%m-%d %H:%M:%S')}] {msg}\n")
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"],
                             capture_output=True, text=True, timeout=30).stdout
        return str(pid) in out
    except Exception:
        return False


def acquire_lock() -> bool:
    SWEEPS.mkdir(parents=True, exist_ok=True)
    if LOCK.exists():
        try:
            old = int(LOCK.read_text().strip())
            if _pid_alive(old):
                log(f"another supervisor is alive (pid {old}) — exiting")
                return False
            log(f"reclaiming stale lock from dead pid {old}")
        except (ValueError, OSError):
            pass
    LOCK.write_text(str(os.getpid()))
    return True


def build_plan(slug: str) -> dict:
    city = get_city(slug)
    min_lon, min_lat, max_lon, max_lat = city["bbox"]
    cell_deg = GRID_KM / 111.0
    band_deg = cell_deg * 2
    bands, lat = [], min_lat
    while lat < max_lat:
        top = min(lat + band_deg, max_lat)
        # A band thinner than one cell yields ZERO grid cells — gosom reports
        # "grid produced 0 cells" and the whole band is silently lost. Extend
        # such a band downward (overlap is harmless; ingest dedupes by place id)
        # rather than leaving a sliver of the city unscraped.
        if top - lat < cell_deg:
            lat = max(min_lat, top - cell_deg * 1.2)
            if bands and bands[-1][0] >= lat:
                bands[-1] = (bands[-1][0], round(top, 5))   # absorb into previous
                break
        bands.append((round(lat, 5), round(top, 5)))
        lat = top
    chunks = [CATEGORIES[i:i + CATS_PER_BATCH]
              for i in range(0, len(CATEGORIES), CATS_PER_BATCH)]
    batches = [
        {"id": f"b{bi:02d}c{ci:02d}",
         "bbox": f"{blat},{min_lon},{tlat},{max_lon}",
         "categories": cats}
        for bi, (blat, tlat) in enumerate(bands)
        for ci, cats in enumerate(chunks)
    ]
    return {"city": slug, "name": city["name"], "grid_km": GRID_KM,
            "bands": len(bands), "cat_chunks": len(chunks), "batches": batches}


def load_state(d: Path) -> dict:
    f = d / "state.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log(f"  corrupt state.json in {d.name}, starting fresh")
    return {"done": [], "failed": {}, "places_seen": 0}


def save_state(d: Path, state: dict) -> None:
    tmp = d / "state.json.tmp"
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(d / "state.json")


def run_batch(slug: str, d: Path, batch: dict) -> int:
    qfile = d / f"q_{batch['id']}.txt"
    out = d / f"{batch['id']}.json"
    tmp = d / f"{batch['id']}.json.tmp"
    errlog = d / f"{batch['id']}.log"
    name = get_city(slug)["name"].split(" / ")[0]
    qfile.write_text("\n".join(f"{c} in {name}" for c in batch["categories"]) + "\n",
                     encoding="utf-8")
    cmd = [
        str(EXE), "-input", str(qfile), "-results", str(tmp), "-json",
        "-c", str(CONCURRENCY), "-depth", str(DEPTH), "-zoom", str(ZOOM),
        "-lang", "en", "-grid-bbox", batch["bbox"], "-grid-cell", str(GRID_KM),
        "-extra-reviews", "-exit-on-inactivity", INACTIVITY,
    ]
    with errlog.open("w", encoding="utf-8", errors="replace") as ef:
        proc = subprocess.Popen(cmd, stdout=ef, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL)
        try:
            proc.wait(timeout=BATCH_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            log(f"  {batch['id']}: {BATCH_TIMEOUT_S}s timeout, killing")
            proc.kill()
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                pass
    n = 0
    if tmp.exists():
        try:
            n = sum(1 for _ in tmp.open(encoding="utf-8"))
            tmp.replace(out)
        except OSError as e:
            log(f"  {batch['id']}: could not finalize ({e})")
    # Cleanup is best-effort: on Windows the child's handle can linger and
    # WinError 32 here must never cost us the batch (or the city).
    for f in (qfile, errlog if n else None):
        if f is not None:
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
    return n


def online() -> bool:
    """Can we actually resolve and reach Google right now?"""
    try:
        socket.setdefaulttimeout(8)
        socket.gethostbyname("www.google.com")
        return True
    except OSError:
        return False


def wait_for_network(max_wait_s: int = 6 * 3600) -> bool:
    """Block until the connection returns.

    A dropped connection produces ERR_NAME_NOT_RESOLVED on every job, so a
    batch 'completes' in ~25s with zero rows. Left alone the supervisor burns
    through the whole city that way and — after three such failures each —
    marks batches done, PERMANENTLY skipping them. An outage must pause the
    sweep, never consume it.
    """
    if online():
        return True
    log("network is down — pausing sweep (batches are NOT consumed while offline)")
    waited, delay = 0, 30
    while waited < max_wait_s:
        time.sleep(delay)
        waited += delay
        if online():
            log(f"network back after {waited // 60} min — resuming")
            return True
        delay = min(delay * 2, 600)
    log(f"network still down after {max_wait_s // 3600}h — giving up this cycle")
    return False


def safe_ingest(slug: str, d: Path) -> dict | None:
    try:
        return ingest_scrape.main(slug, d)
    except Exception as e:
        log(f"  ingest failed (non-fatal, data is safe on disk): {e}")
        return None


def sweep_city(slug: str) -> bool:
    """Returns True when every batch for the city is finished."""
    d = SWEEPS / slug
    d.mkdir(parents=True, exist_ok=True)
    pf = d / "plan.json"
    plan = (json.loads(pf.read_text(encoding="utf-8")) if pf.exists()
            else build_plan(slug))
    if not pf.exists():
        pf.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    state = load_state(d)
    total = len(plan["batches"])
    todo = [b for b in plan["batches"] if b["id"] not in state["done"]]
    if not todo:
        return True

    log(f"=== {plan['name']}: {len(todo)}/{total} batches remaining "
        f"({plan['bands']}x{plan['cat_chunks']} grid @ {plan['grid_km']}km) ===")
    since_ingest = 0
    for batch in todo:
        if not wait_for_network():
            return False                      # try this city again next cycle
        t0 = time.time()
        try:
            n = run_batch(slug, d, batch)
        except Exception as e:
            # One bad batch must never abandon the city.
            log(f"  {batch['id']} errored: {e} — skipping to next batch")
            n = 0
        dt = time.time() - t0
        state["places_seen"] += n

        if n:
            state["done"].append(batch["id"])
            state["failed"].pop(batch["id"], None)
        elif dt < NO_SEARCH_S:
            # Zero rows THAT FAST means no search actually ran — a real cell
            # takes many minutes even when sparse. Measured across 260 logged
            # batches, every fast-zero was transient (dead network, a gmaps
            # start-up error) and every one of them yielded rows on a later
            # cycle; not one legitimately-empty cell ever returned in under
            # 90s. Previously this forgiveness required the network to ALSO
            # be down at that instant, so a crash-looping binary on a live
            # connection could burn three strikes and retire a cell as
            # "genuinely empty" — silent, permanent coverage loss in a
            # project whose whole point is complete data. Never score it.
            state["fast_zero"] = state.get("fast_zero", 0) + 1
            log(f"  {batch['id']}: 0 rows in {dt:.0f}s — no search ran, not counted "
                f"(fast-zero #{state['fast_zero']})")
            save_state(d, state)
            if not online():
                wait_for_network()
            else:
                # Back off a little so a hard-failing binary can't spin.
                time.sleep(min(30 * state["fast_zero"], 300))
            continue
        else:
            state["failed"][batch["id"]] = state["failed"].get(batch["id"], 0) + 1
            if state["failed"][batch["id"]] >= 3:
                state["done"].append(batch["id"])   # genuinely empty area
        save_state(d, state)
        done_n = len(state["done"])
        log(f"  [{done_n}/{total}] {batch['id']} {batch['categories'][0][:16]}: "
            f"{n:,} rows in {time.time() - t0:.0f}s (city total {state['places_seen']:,})")
        since_ingest += 1
        if since_ingest >= INGEST_EVERY:
            since_ingest = 0
            safe_ingest(slug, d)

    st = safe_ingest(slug, d)
    if st:
        log(f"=== {plan['name']} DONE: {st['total_after']:,} places "
            f"(+{st['discovered']:,} discovered, {st['enriched']:,} enriched) ===")
    return len([b for b in plan["batches"] if b["id"] not in state["done"]]) == 0


def main() -> None:
    if not acquire_lock():
        return
    targets = sys.argv[1:] or SWEEP_ORDER
    try:
        for cycle in range(1, MAX_CYCLES + 1):
            remaining = []
            for slug in targets:
                try:
                    if not sweep_city(slug):
                        remaining.append(slug)
                except Exception as e:
                    log(f"!!! {slug} threw: {e} — will retry next cycle")
                    remaining.append(slug)
            if not remaining:
                log(f"ALL CITIES COMPLETE after cycle {cycle}")
                return
            log(f"cycle {cycle} done; {len(remaining)} cities incomplete: "
                f"{', '.join(remaining)} — retrying")
            targets = remaining
            time.sleep(60)
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
